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
import * as schema from "../../db/schema";
import type { Env } from "../../index";
import { syncAllUsers } from "../lib/sync";
import type { Session } from "../middleware/session";

type Variables = { session: Session | null };

const adminOps = new Hono<{ Bindings: Env; Variables: Variables }>();

adminOps.post("/sync", async (c) => {
	await syncAllUsers(c.env.DB, c.env.SLACK_ADMIN_TOKEN);
	return c.json({ ok: true });
});

adminOps.post("/queue-announcements", async (c) => {
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

adminOps.post("/clear-db", async (c) => {
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

adminOps.get("/stats", async (c) => {
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

export default adminOps;
