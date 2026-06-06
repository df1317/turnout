import {
	and,
	count,
	sql as drizzleSql,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	ne,
	or,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { SlackAPIClient } from "slack-web-api-client";
import * as schema from "../../db/schema";
import type { Env } from "../../index";
import { syncAllUsers } from "../lib/sync";
import type { Session } from "../middleware/session";
import { requireAdmin } from "../middleware/session";
import adminCdts from "./admin-cdts";
import adminMeetings from "./admin-meetings";
import adminUsers from "./admin-users";

type Variables = { session: Session | null };

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use("*", requireAdmin());

// Mount domain sub-routers
admin.route("/users", adminUsers);
admin.route("/cdts", adminCdts);
admin.route("/meetings", adminMeetings);

// Sync
admin.post("/sync", async (c) => {
	await syncAllUsers(c.env.DB, c.env.SLACK_ADMIN_TOKEN);
	return c.json({ ok: true });
});

// Queue announcements
admin.post("/queue-announcements", async (c) => {
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);
	const activeMeetings = await db
		.select({ id: schema.meeting.id })
		.from(schema.meeting)
		.where(
			and(
				eq(schema.meeting.cancelled, 0),
				ne(schema.meeting.messageTs, ""),
				ne(schema.meeting.channelId, ""),
				or(isNull(schema.meeting.endTime), gt(schema.meeting.endTime, now)),
			),
		)
		.all();

	if (activeMeetings.length === 0) {
		return c.json({ ok: true, count: 0 });
	}

	for (const m of activeMeetings) {
		await db
			.insert(schema.pendingAnnouncement)
			.values({ meetingId: m.id, queuedAt: now })
			.onConflictDoUpdate({
				target: schema.pendingAnnouncement.meetingId,
				set: { queuedAt: now },
			});
	}

	return c.json({ ok: true, count: activeMeetings.length });
});

// Clear database
admin.post("/clear-db", async (c) => {
	const session = c.get("session");
	const currentUserId = session?.user_id;
	const db = drizzle(c.env.DB);

	await db.delete(schema.attendance);
	await db.delete(schema.pendingAnnouncement);
	await db.delete(schema.meeting);
	await db.delete(schema.meetingSeries);
	await db.delete(schema.cdtMember);
	await db.delete(schema.cdt);
	await db.delete(schema.slackCache);

	if (currentUserId) {
		await db
			.delete(schema.slackUser)
			.where(ne(schema.slackUser.userId, currentUserId));
	} else {
		await db.delete(schema.slackUser);
	}

	return c.json({ ok: true });
});

// Stats
admin.get("/stats", async (c) => {
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);
	const [
		usersResult,
		meetingsResult,
		pastMeetingsResult,
		pendingAnnouncementsResult,
		cdtsResult,
		attendanceResult,
	] = await Promise.all([
		db.select({ count: count() }).from(schema.slackUser).get(),
		db
			.select({ count: count() })
			.from(schema.meeting)
			.where(
				and(
					eq(schema.meeting.cancelled, 0),
					or(
						and(
							isNotNull(schema.meeting.endTime),
							gt(schema.meeting.endTime, now),
						),
						and(
							isNull(schema.meeting.endTime),
							drizzleSql`${schema.meeting.scheduledAt} + (3 * 60 * 60) > ${now}`,
						),
					),
				),
			)
			.get(),
		db
			.select({ count: count() })
			.from(schema.meeting)
			.where(
				and(
					eq(schema.meeting.cancelled, 0),
					or(
						and(
							isNotNull(schema.meeting.endTime),
							lte(schema.meeting.endTime, now),
						),
						and(
							isNull(schema.meeting.endTime),
							drizzleSql`${schema.meeting.scheduledAt} + (3 * 60 * 60) <= ${now}`,
						),
					),
				),
			)
			.get(),
		db.select({ count: count() }).from(schema.pendingAnnouncement).get(),
		db.select({ count: count() }).from(schema.cdt).get(),
		db.select({ count: count() }).from(schema.attendance).get(),
	]);

	return c.json({
		users: usersResult?.count ?? 0,
		meetings: meetingsResult?.count ?? 0,
		pastMeetings: pastMeetingsResult?.count ?? 0,
		pendingAnnouncements: pendingAnnouncementsResult?.count ?? 0,
		cdts: cdtsResult?.count ?? 0,
		attendance: attendanceResult?.count ?? 0,
	});
});

// Settings
admin.get("/settings/:key", async (c) => {
	const key = c.req.param("key");
	const db = drizzle(c.env.DB);
	const row = await db
		.select({ value: schema.kvStore.value })
		.from(schema.kvStore)
		.where(eq(schema.kvStore.key, key))
		.get();
	return c.json({ value: row?.value ?? null });
});

admin.post("/settings/:key", async (c) => {
	const key = c.req.param("key");
	const { value } = await c.req.json<{ value: string }>();
	const db = drizzle(c.env.DB);
	await db
		.insert(schema.kvStore)
		.values({ key, value })
		.onConflictDoUpdate({ target: schema.kvStore.key, set: { value } });
	return c.json({ ok: true });
});

// Slack channels
admin.get("/slack/channels", async (c) => {
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);
	const cached = await db
		.select({
			value: schema.slackCache.value,
			expiresAt: schema.slackCache.expiresAt,
		})
		.from(schema.slackCache)
		.where(eq(schema.slackCache.key, "channels"))
		.get();

	if (cached && cached.expiresAt > now) {
		return c.json(JSON.parse(cached.value));
	}

	const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
	const allChannels: { id: string; name: string; is_private: boolean }[] = [];
	let cursor: string | undefined;

	do {
		const result = (await botClient.conversations.list({
			types: ["public_channel"],
			limit: 1000,
			...(cursor ? { cursor } : {}),
		})) as {
			channels?: {
				id: string;
				name: string;
				is_private: boolean;
				is_archived: boolean;
			}[];
			response_metadata?: { next_cursor: string };
		};

		for (const ch of result.channels ?? []) {
			if (!ch.is_archived) {
				allChannels.push({
					id: ch.id,
					name: ch.name,
					is_private: ch.is_private,
				});
			}
		}
		cursor = result.response_metadata?.next_cursor || undefined;
	} while (cursor);

	allChannels.sort((a, b) => a.name.localeCompare(b.name));

	await db
		.insert(schema.slackCache)
		.values({
			key: "channels",
			value: JSON.stringify(allChannels),
			expiresAt: now + 600,
		})
		.onConflictDoUpdate({
			target: schema.slackCache.key,
			set: { value: JSON.stringify(allChannels), expiresAt: now + 600 },
		});

	return c.json(allChannels);
});

export default admin;
