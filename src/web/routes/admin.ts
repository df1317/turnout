import {
	and,
	asc,
	count,
	desc,
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
import {
	buildAnnouncementBlocks,
	updateAnnouncement,
} from "../../lib/announcements";
import {
	clearCdtProfile,
	deleteSlackUsergroup,
	sendWelcomeMessage,
	syncCdtUsers,
} from "../../lib/slack-cdt";
import { syncAllUsers } from "../lib/sync";
import type { Session } from "../middleware/session";
import { requireAdmin } from "../middleware/session";

type Variables = { session: Session | null };

const slugify = (name: string) =>
	`${name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")}-cdt`;

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use("*", requireAdmin());

admin.post("/users/bulk/role", async (c) => {
	const { user_ids, role } = await c.req.json<{
		user_ids: string[];
		role: string | null;
	}>();
	if (!user_ids?.length) return c.json({ error: "No user IDs provided" }, 400);
	const validRoles = ["student", "mentor", "parent", "alumni"];
	if (role && !validRoles.includes(role))
		return c.json({ error: "Invalid role" }, 400);

	const db = drizzle(c.env.DB);
	for (const id of user_ids) {
		await db
			.update(schema.slackUser)
			// biome-ignore lint/suspicious/noExplicitAny: role is validated above
			.set({ role: role as any })
			.where(eq(schema.slackUser.userId, id));
	}

	return c.json({ ok: true });
});

admin.post("/users/bulk/cdt", async (c) => {
	const { user_ids, cdt_id } = await c.req.json<{
		user_ids: string[];
		cdt_id: string | null;
	}>();
	if (!user_ids?.length) return c.json({ error: "No user IDs provided" }, 400);

	const db = drizzle(c.env.DB);
	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);

	if (cdt_id === null) {
		for (const id of user_ids) {
			const currentCdt = await db
				.select({ cdt_id: schema.cdtMember.cdtId })
				.from(schema.cdtMember)
				.where(eq(schema.cdtMember.userId, id))
				.get();

			await db.delete(schema.cdtMember).where(eq(schema.cdtMember.userId, id));
			await clearCdtProfile(adminClient, id, c.env);

			if (currentCdt) {
				await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
			}
		}
	} else {
		for (const id of user_ids) {
			const currentCdt = await db
				.select({ cdt_id: schema.cdtMember.cdtId })
				.from(schema.cdtMember)
				.where(eq(schema.cdtMember.userId, id))
				.get();

			await db
				.insert(schema.cdtMember)
				.values({ userId: id, cdtId: cdt_id })
				.onConflictDoUpdate({
					target: schema.cdtMember.userId,
					set: { cdtId: cdt_id },
				});

			if (currentCdt && currentCdt.cdt_id !== cdt_id) {
				await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
			}
		}
		await syncCdtUsers(c.env.DB, adminClient, cdt_id, c.env);
	}
	return c.json({ ok: true });
});

admin.post("/users/:userId/role", async (c) => {
	const userId = c.req.param("userId");
	const { role } = await c.req.json<{ role: string | null }>();
	const validRoles = ["student", "mentor", "parent", "alumni"];
	if (role && !validRoles.includes(role))
		return c.json({ error: "Invalid role" }, 400);
	const db = drizzle(c.env.DB);
	await db
		.update(schema.slackUser)
		// biome-ignore lint/suspicious/noExplicitAny: role is validated above
		.set({ role: role as any })
		.where(eq(schema.slackUser.userId, userId));
	return c.json({ ok: true });
});

admin.get("/users/:userId/meetings", async (c) => {
	const userId = c.req.param("userId");
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			status: schema.attendance.status,
			note: schema.attendance.note,
		})
		.from(schema.attendance)
		.innerJoin(
			schema.meeting,
			eq(schema.meeting.id, schema.attendance.meetingId),
		)
		.where(eq(schema.attendance.userId, userId))
		.orderBy(desc(schema.meeting.scheduledAt))
		.limit(20)
		.all();
	return c.json(rows);
});

admin.post("/users/:userId/cdt", async (c) => {
	const userId = c.req.param("userId");
	const { cdt_id } = await c.req.json<{ cdt_id: string | null }>();

	const db = drizzle(c.env.DB);
	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);
	const currentCdt = await db
		.select({ cdt_id: schema.cdtMember.cdtId })
		.from(schema.cdtMember)
		.where(eq(schema.cdtMember.userId, userId))
		.get();

	if (cdt_id === null) {
		await db
			.delete(schema.cdtMember)
			.where(eq(schema.cdtMember.userId, userId));
		await clearCdtProfile(adminClient, userId, c.env);
	} else {
		await db
			.insert(schema.cdtMember)
			.values({ userId, cdtId: cdt_id })
			.onConflictDoUpdate({
				target: schema.cdtMember.userId,
				set: { cdtId: cdt_id },
			});
	}

	if (currentCdt && currentCdt.cdt_id !== cdt_id) {
		await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
	}
	if (cdt_id) {
		await syncCdtUsers(c.env.DB, adminClient, cdt_id, c.env);
	}

	return c.json({ ok: true });
});

admin.get("/cdts", async (c) => {
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
			channel_id: schema.cdt.channelId,
			member_count: count(schema.slackUser.userId),
		})
		.from(schema.cdt)
		.leftJoin(schema.cdtMember, eq(schema.cdtMember.cdtId, schema.cdt.id))
		.leftJoin(
			schema.slackUser,
			eq(schema.slackUser.userId, schema.cdtMember.userId),
		)
		.groupBy(schema.cdt.id)
		.orderBy(drizzleSql`${schema.cdt.name} COLLATE NOCASE`)
		.all();
	return c.json(rows);
});

admin.get("/cdts/:id", async (c) => {
	const id = c.req.param("id");
	const db = drizzle(c.env.DB);
	const cdtRow = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
			channel_id: schema.cdt.channelId,
		})
		.from(schema.cdt)
		.where(eq(schema.cdt.id, id))
		.get();
	if (!cdtRow) return c.json({ error: "Not found" }, 404);

	const members = await db
		.select({
			user_id: schema.slackUser.userId,
			name: schema.slackUser.name,
			avatar_url: schema.slackUser.avatarUrl,
		})
		.from(schema.cdtMember)
		.innerJoin(
			schema.slackUser,
			eq(schema.slackUser.userId, schema.cdtMember.userId),
		)
		.where(eq(schema.cdtMember.cdtId, id))
		.orderBy(drizzleSql`${schema.slackUser.name} COLLATE NOCASE`)
		.all();

	return c.json({
		...cdtRow,
		member_count: members.length,
		members,
	});
});

admin.post("/cdts", async (c) => {
	const { name, handle, channel_id } = await c.req.json<{
		name: string;
		handle?: string;
		channel_id?: string;
	}>();
	if (!name) return c.json({ error: "Name is required" }, 400);
	const finalHandle = handle || slugify(name);

	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);
	let result: { usergroup?: { id: string } } | undefined;
	try {
		result = (await adminClient.usergroups.create({
			name,
			handle: finalHandle,
			...(channel_id ? { channels: channel_id } : {}),
		})) as { usergroup?: { id: string } };
	} catch (err: unknown) {
		const error = err as { error?: string };
		if (error?.error === "name_already_exists") {
			return c.json(
				{
					error: "A Slack usergroup with this name or handle already exists.",
				},
				400,
			);
		}
		return c.json(
			{ error: error?.error || "Failed to create Slack usergroup" },
			500,
		);
	}

	const groupId = result?.usergroup?.id;
	if (!groupId)
		return c.json({ error: "Failed to create Slack usergroup" }, 500);

	const db = drizzle(c.env.DB);
	await db.insert(schema.cdt).values({
		id: groupId,
		name,
		handle: finalHandle,
		channelId: channel_id ?? "",
	});

	const cdtRow = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
			channel_id: schema.cdt.channelId,
		})
		.from(schema.cdt)
		.where(eq(schema.cdt.id, groupId))
		.get();

	if (channel_id && groupId) {
		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		await sendWelcomeMessage(botClient, groupId, channel_id, name);
	}

	return c.json({ ...cdtRow, member_count: 0 }, 201);
});

admin.put("/cdts/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<{
		name?: string;
		channel_id?: string;
		members?: string[];
	}>();
	const db = drizzle(c.env.DB);

	// biome-ignore lint/suspicious/noExplicitAny: dynamic update set
	const updateSet: Record<string, any> = {};
	if (body.name !== undefined) updateSet.name = body.name;
	if (body.channel_id !== undefined) updateSet.channelId = body.channel_id;

	if (Object.keys(updateSet).length > 0) {
		await db.update(schema.cdt).set(updateSet).where(eq(schema.cdt.id, id));
	}

	if (body.members !== undefined) {
		const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);

		const currentRows = await db
			.select({ user_id: schema.cdtMember.userId })
			.from(schema.cdtMember)
			.where(eq(schema.cdtMember.cdtId, id))
			.all();
		const currentSet = new Set(currentRows.map((r) => r.user_id));
		const newSet = new Set(body.members);

		const added = body.members.filter((uid) => !currentSet.has(uid));
		const removed = [...currentSet].filter((uid) => !newSet.has(uid));

		for (const userId of removed) {
			await db
				.delete(schema.cdtMember)
				.where(
					and(
						eq(schema.cdtMember.userId, userId),
						eq(schema.cdtMember.cdtId, id),
					),
				);
			await clearCdtProfile(adminClient, userId, c.env);
		}

		for (const userId of added) {
			const currentCdt = await db
				.select({ cdt_id: schema.cdtMember.cdtId })
				.from(schema.cdtMember)
				.where(eq(schema.cdtMember.userId, userId))
				.get();

			await db
				.insert(schema.cdtMember)
				.values({ userId, cdtId: id })
				.onConflictDoUpdate({
					target: schema.cdtMember.userId,
					set: { cdtId: id },
				});

			if (currentCdt && currentCdt.cdt_id !== id) {
				await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
			}
		}

		await syncCdtUsers(c.env.DB, adminClient, id, c.env);
	} else if (Object.keys(updateSet).length === 0) {
		return c.json({ error: "No fields to update" }, 400);
	}

	return c.json({ ok: true });
});

admin.delete("/cdts/:id", async (c) => {
	const id = c.req.param("id");
	const db = drizzle(c.env.DB);
	const cdtRow = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
		})
		.from(schema.cdt)
		.where(eq(schema.cdt.id, id))
		.get();

	if (!cdtRow) return c.json({ error: "Not found" }, 404);

	const members = await db
		.select({ user_id: schema.cdtMember.userId })
		.from(schema.cdtMember)
		.where(eq(schema.cdtMember.cdtId, id))
		.all();

	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);

	await Promise.all([
		deleteSlackUsergroup(adminClient, id, cdtRow.name, cdtRow.handle),
		...members.map(({ user_id }) =>
			clearCdtProfile(adminClient, user_id, c.env),
		),
	]);

	await db.delete(schema.cdt).where(eq(schema.cdt.id, id));
	return c.json({ ok: true });
});

admin.get("/meetings", async (c) => {
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			channel_id: schema.meeting.channelId,
			message_ts: schema.meeting.messageTs,
			cancelled: schema.meeting.cancelled,
			series_id: schema.meeting.seriesId,
			yes_count: drizzleSql<number>`COALESCE(SUM(CASE WHEN ${schema.attendance.status} = 'yes' THEN 1 ELSE 0 END), 0)`,
			maybe_count: drizzleSql<number>`COALESCE(SUM(CASE WHEN ${schema.attendance.status} = 'maybe' THEN 1 ELSE 0 END), 0)`,
			no_count: drizzleSql<number>`COALESCE(SUM(CASE WHEN ${schema.attendance.status} = 'no' THEN 1 ELSE 0 END), 0)`,
		})
		.from(schema.meeting)
		.leftJoin(
			schema.attendance,
			eq(schema.attendance.meetingId, schema.meeting.id),
		)
		.where(
			or(
				and(isNotNull(schema.meeting.endTime), gt(schema.meeting.endTime, now)),
				and(
					isNull(schema.meeting.endTime),
					drizzleSql`${schema.meeting.scheduledAt} + (3 * 60 * 60) > ${now}`,
				),
				gt(schema.meeting.scheduledAt, now),
			),
		)
		.groupBy(schema.meeting.id)
		.orderBy(asc(schema.meeting.scheduledAt))
		.limit(100)
		.all();
	return c.json(rows.map((r) => ({ ...r, cancelled: r.cancelled === 1 })));
});

admin.get("/meetings/:id/attendance", async (c) => {
	const id = Number(c.req.param("id"));
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			user_id: schema.attendance.userId,
			status: schema.attendance.status,
			note: schema.attendance.note,
			name: schema.slackUser.name,
			avatar_url: schema.slackUser.avatarUrl,
		})
		.from(schema.attendance)
		.innerJoin(
			schema.slackUser,
			eq(schema.slackUser.userId, schema.attendance.userId),
		)
		.where(eq(schema.attendance.meetingId, id))
		.orderBy(drizzleSql`${schema.slackUser.name} COLLATE NOCASE`)
		.all();
	return c.json(rows);
});

admin.post("/meetings", async (c) => {
	const body = await c.req.json<{
		name: string;
		description?: string;
		scheduled_at: number;
		end_time?: number;
		channel_id?: string;
	}>();
	const { name, description = "", scheduled_at, end_time, channel_id } = body;
	if (!name) return c.json({ error: "Name is required" }, 400);

	const now = Math.floor(Date.now() / 1000);
	const twoWeeksInSeconds = 14 * 24 * 60 * 60;
	const shouldAnnounceNow = scheduled_at <= now + twoWeeksInSeconds;

	let message_ts: string | null = null;

	const db = drizzle(c.env.DB);
	const result = await db
		.insert(schema.meeting)
		.values({
			name,
			description,
			scheduledAt: scheduled_at,
			endTime: end_time ?? null,
			channelId: channel_id ?? "",
			messageTs: "",
			cancelled: 0,
		})
		.returning({ id: schema.meeting.id })
		.get();

	const id = result?.id;
	if (!id) return c.json({ error: "Failed to insert meeting" }, 500);

	if (channel_id && shouldAnnounceNow) {
		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		await botClient.conversations.join({ channel: channel_id }).catch(() => {});
		const blocks = buildAnnouncementBlocks(
			{ id, name, description, scheduled_at, end_time: end_time ?? null },
			{ yes: [], maybe: [], no: [] },
		);
		const posted = (await botClient.chat.postMessage({
			channel: channel_id,
			text: `Meeting: ${name}`,
			blocks,
		})) as { ts?: string };

		message_ts = posted.ts ?? null;

		if (message_ts) {
			await db
				.update(schema.meeting)
				.set({ messageTs: message_ts })
				.where(eq(schema.meeting.id, id));
		}
	}

	return c.json(
		{
			id,
			name,
			description,
			scheduled_at,
			end_time: end_time ?? null,
			channel_id: channel_id ?? null,
			message_ts,
			cancelled: false,
			series_id: null,
			yes_count: 0,
			maybe_count: 0,
			no_count: 0,
		},
		201,
	);
});

admin.put("/meetings/:id", async (c) => {
	const id = Number(c.req.param("id"));
	const body = await c.req.json<{
		name?: string;
		description?: string;
		scheduled_at?: number;
		end_time?: number | null;
	}>();

	// biome-ignore lint/suspicious/noExplicitAny: dynamic update set
	const updateSet: Record<string, any> = {};
	if (body.name !== undefined) updateSet.name = body.name;
	if (body.description !== undefined) updateSet.description = body.description;
	if (body.scheduled_at !== undefined)
		updateSet.scheduledAt = body.scheduled_at;
	if (body.end_time !== undefined) updateSet.endTime = body.end_time;

	if (Object.keys(updateSet).length === 0)
		return c.json({ error: "No fields to update" }, 400);

	const db = drizzle(c.env.DB);
	await db
		.update(schema.meeting)
		.set(updateSet)
		.where(eq(schema.meeting.id, id));

	const meetingRow = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			channel_id: schema.meeting.channelId,
			message_ts: schema.meeting.messageTs,
			cancelled: schema.meeting.cancelled,
		})
		.from(schema.meeting)
		.where(eq(schema.meeting.id, id))
		.get();

	if (meetingRow) {
		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		await updateAnnouncement(botClient, c.env.DB, meetingRow).catch((err) =>
			console.error("meeting update announcement failed:", err),
		);
	}

	return c.json({ ok: true });
});

admin.post("/meetings/:id/cancel", async (c) => {
	const id = Number(c.req.param("id"));
	const { cancelled } = await c.req.json<{ cancelled: boolean }>();
	const db = drizzle(c.env.DB);
	await db
		.update(schema.meeting)
		.set({ cancelled: cancelled ? 1 : 0 })
		.where(eq(schema.meeting.id, id));

	const meetingRow = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			channel_id: schema.meeting.channelId,
			message_ts: schema.meeting.messageTs,
			cancelled: schema.meeting.cancelled,
		})
		.from(schema.meeting)
		.where(eq(schema.meeting.id, id))
		.get();

	if (meetingRow) {
		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		c.executionCtx.waitUntil(
			updateAnnouncement(botClient, c.env.DB, meetingRow).catch((err) =>
				console.error("cancel announcement update failed:", err),
			),
		);
	}

	return c.json({ ok: true });
});

admin.post("/meetings/series", async (c) => {
	const body = await c.req.json<{
		name: string;
		description?: string;
		scheduled_at: number;
		duration_minutes?: number;
		channel_id?: string;
		days_of_week: number[];
		time_of_day_minutes: number;
		end_date: number;
	}>();
	const {
		name,
		description = "",
		scheduled_at,
		duration_minutes,
		channel_id,
		days_of_week,
		time_of_day_minutes,
		end_date,
	} = body;
	if (!name || !days_of_week.length || !end_date)
		return c.json({ error: "Missing fields" }, 400);

	const { generateDates } = await import("../../lib/recurrence");
	const dates = generateDates(
		days_of_week,
		time_of_day_minutes,
		scheduled_at,
		end_date,
	);
	if (dates.length === 0)
		return c.json({ error: "No occurrences generated" }, 400);

	const db = drizzle(c.env.DB);
	const seriesResult = await db
		.insert(schema.meetingSeries)
		.values({
			name,
			description,
			daysOfWeek: JSON.stringify(days_of_week),
			timeOfDay: time_of_day_minutes,
			endDate: end_date,
		})
		.returning({ id: schema.meetingSeries.id })
		.get();
	const seriesId = seriesResult?.id;
	if (!seriesId)
		return c.json({ error: "Failed to insert meeting series" }, 500);

	const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
	const created: {
		id: number;
		scheduled_at: number;
		end_time: number | null;
		message_ts: string | null;
	}[] = [];

	const now = Math.floor(Date.now() / 1000);
	const twoWeeksInSeconds = 14 * 24 * 60 * 60;

	for (const ts of dates) {
		let message_ts: string | null = null;
		const shouldAnnounceNow = ts <= now + twoWeeksInSeconds;
		const end_time = duration_minutes ? ts + duration_minutes * 60 : null;

		const result = await db
			.insert(schema.meeting)
			.values({
				seriesId,
				name,
				description,
				scheduledAt: ts,
				endTime: end_time,
				channelId: channel_id ?? "",
				messageTs: "",
				cancelled: 0,
			})
			.returning({ id: schema.meeting.id })
			.get();
		const id = result?.id;
		if (!id) continue;

		if (channel_id && shouldAnnounceNow) {
			try {
				await botClient.conversations.join({ channel: channel_id });
			} catch {}
			const blocks = buildAnnouncementBlocks(
				{ id, name, description, scheduled_at: ts, end_time },
				{ yes: [], maybe: [], no: [] },
			);
			const posted = (await botClient.chat.postMessage({
				channel: channel_id,
				text: `Meeting: ${name}`,
				blocks,
			})) as { ts?: string };
			message_ts = posted.ts ?? null;

			if (message_ts) {
				await db
					.update(schema.meeting)
					.set({ messageTs: message_ts })
					.where(eq(schema.meeting.id, id));
			}
		}

		created.push({
			id,
			scheduled_at: ts,
			end_time,
			message_ts,
		});
	}

	return c.json(
		{
			series_id: seriesId,
			count: created.length,
			meetings: created,
		},
		201,
	);
});

admin.post("/meetings/import-ics", async (c) => {
	const body = await c.req.json<{
		url: string;
		channel_id?: string;
	}>();

	if (!body.url) return c.json({ error: "Missing url" }, 400);

	const db = drizzle(c.env.DB);
	let channel_id = body.channel_id;
	if (!channel_id) {
		const setting = await db
			.select({ value: schema.kvStore.value })
			.from(schema.kvStore)
			.where(eq(schema.kvStore.key, "default_channel"))
			.get();
		if (setting?.value) {
			channel_id = setting.value;
		}
	}

	try {
		const res = await fetch(body.url);
		if (!res.ok) {
			return c.json(
				{ error: `Failed to fetch ICS: ${res.status} ${res.statusText}` },
				400,
			);
		}
		const icsData = await res.text();

		// We use dynamic import for node-ical so it doesn't break cloudflare worker startup if there are issues
		const ical = await import("node-ical");
		const events = await ical.async.parseICS(icsData);

		const created: {
			id: number;
			name: string;
			scheduled_at: number;
			end_time: number | null;
			cancelled: boolean;
		}[] = [];

		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		const now = Math.floor(Date.now() / 1000);
		const twoWeeksInSeconds = 14 * 24 * 60 * 60;

		if (body.channel_id) {
			try {
				await botClient.conversations.join({ channel: body.channel_id });
			} catch {}
		}

		// Create a series for the imported calendar
		const seriesResult = await db
			.insert(schema.meetingSeries)
			.values({
				name: `ICS Import: ${new Date().toLocaleDateString()}`,
				description: "",
				daysOfWeek: "[]",
				timeOfDay: 0,
				endDate: 0,
			})
			.returning({ id: schema.meetingSeries.id })
			.get();
		const seriesId = seriesResult?.id;
		if (!seriesId) return c.json({ error: "Failed to insert series" }, 500);

		for (const event of Object.values(events)) {
			// @ts-expect-line TypeScript type for node-ical VEvent missing things
			if (event?.type !== "VEVENT") continue;
			// biome-ignore lint/suspicious/noExplicitAny: node-ical types are inaccurate
			const vEvent = event as any;

			const start = new Date(vEvent.start);
			const scheduled_at = Math.floor(start.getTime() / 1000);

			// Skip past events based on their end time (or start time + fallback)
			let end_time = null;
			if (vEvent.end) {
				end_time = Math.floor(new Date(vEvent.end).getTime() / 1000);
			}

			let defaultMeetingLength = 3;
			const setting = await db
				.select({ value: schema.kvStore.value })
				.from(schema.kvStore)
				.where(eq(schema.kvStore.key, "default_meeting_length"))
				.get();
			if (setting?.value) {
				defaultMeetingLength = parseInt(setting.value, 10);
			}

			const isPast = end_time
				? end_time <= now
				: scheduled_at + defaultMeetingLength * 60 * 60 <= now;

			if (isPast) {
				continue;
			}

			const name = vEvent.summary || "Imported Meeting";
			let description = vEvent.description || "";

			// Clean up redundant TeamSnap timezone strings
			if (typeof description === "string") {
				// Strip the entire line if it contains Arrival Time
				description = description.replace(/^.*Arrival Time:.*\n?/gim, "");
				// Also clean up any lingering timezone strings
				description = description.replace(
					/\s*\([A-Za-z]+ Time \(US & Canada\)\)/gi,
					"",
				);
				description = description.trim();
			}

			const isCancelled =
				name.toLowerCase().includes("[canceled]") ||
				name.toLowerCase().includes("[cancelled]");
			const cleanName = name
				.replace(/\[CANCELED\]\s*/i, "")
				.replace(/\[CANCELLED\]\s*/i, "");

			// Deduplication check
			const existing = await db
				.select({ id: schema.meeting.id })
				.from(schema.meeting)
				.where(
					and(
						eq(schema.meeting.name, cleanName),
						eq(schema.meeting.scheduledAt, scheduled_at),
					),
				)
				.get();

			if (existing) {
				continue; // Skip if a meeting with the same name and start time already exists
			}

			let message_ts: string | null = null;
			const shouldAnnounceNow = scheduled_at <= now + twoWeeksInSeconds;

			const result = await db
				.insert(schema.meeting)
				.values({
					seriesId,
					name: cleanName,
					description,
					scheduledAt: scheduled_at,
					endTime: end_time,
					channelId: channel_id ?? "",
					messageTs: "",
					cancelled: isCancelled ? 1 : 0,
				})
				.returning({ id: schema.meeting.id })
				.get();
			const id = result?.id;
			if (!id) continue;

			if (body.channel_id && shouldAnnounceNow && !isCancelled) {
				try {
					const blocks = buildAnnouncementBlocks(
						{ id, name: cleanName, description, scheduled_at, end_time },
						{ yes: [], maybe: [], no: [] },
					);
					const posted = (await botClient.chat.postMessage({
						channel: body.channel_id,
						text: `Meeting: ${cleanName}`,
						blocks,
					})) as { ts?: string };
					message_ts = posted.ts ?? null;

					if (message_ts) {
						await db
							.update(schema.meeting)
							.set({ messageTs: message_ts })
							.where(eq(schema.meeting.id, id));
					}
				} catch (err) {
					console.error("Failed to announce imported meeting", err);
				}
			}

			created.push({
				id,
				name: cleanName,
				scheduled_at,
				end_time,
				cancelled: isCancelled,
			});
		}

		return c.json({
			ok: true,
			count: created.length,
			meetings: created,
		});
	} catch (error: unknown) {
		console.error("Error importing ICS:", error);
		return c.json(
			{ error: (error as Error).message || "Failed to parse ICS" },
			500,
		);
	}
});

admin.delete("/meetings/:id", async (c) => {
	const id = Number(c.req.param("id"));
	const db = drizzle(c.env.DB);
	const meetingRow = await db
		.select({
			id: schema.meeting.id,
			channel_id: schema.meeting.channelId,
			message_ts: schema.meeting.messageTs,
		})
		.from(schema.meeting)
		.where(eq(schema.meeting.id, id))
		.get();

	await db.delete(schema.meeting).where(eq(schema.meeting.id, id));

	if (meetingRow?.message_ts && meetingRow?.channel_id) {
		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		c.executionCtx.waitUntil(
			botClient.chat
				.delete({
					channel: meetingRow.channel_id,
					ts: meetingRow.message_ts,
				})
				.catch(() => {}),
		);
	}

	return c.json({ ok: true });
});

admin.post("/sync", async (c) => {
	await syncAllUsers(c.env.DB, c.env.SLACK_ADMIN_TOKEN);
	return c.json({ ok: true });
});

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
