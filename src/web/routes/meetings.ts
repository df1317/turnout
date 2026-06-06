import {
	and,
	asc,
	desc,
	sql as drizzleSql,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	or,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../../db/schema";
import type { Env } from "../../index";
import type { Session } from "../middleware/session";
import { requireSession, sessionMiddleware } from "../middleware/session";

type Variables = { session: Session | null };

const meetings = new Hono<{ Bindings: Env; Variables: Variables }>();

meetings.use("*", sessionMiddleware);

meetings.get("/meetings", requireSession(), async (c) => {
	// biome-ignore lint/style/noNonNullAssertion: guaranteed by requireSession
	const session = c.get("session")!;
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			my_status: schema.attendance.status,
			my_note: schema.attendance.note,
			yes_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'yes')`,
			maybe_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'maybe')`,
			no_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'no')`,
		})
		.from(schema.meeting)
		.leftJoin(
			schema.attendance,
			and(
				eq(schema.attendance.meetingId, schema.meeting.id),
				eq(schema.attendance.userId, session.user_id),
			),
		)
		.where(
			and(
				eq(schema.meeting.cancelled, 0),
				or(
					gt(schema.meeting.scheduledAt, now),
					and(
						isNotNull(schema.meeting.endTime),
						gt(schema.meeting.endTime, now),
					),
					and(
						isNull(schema.meeting.endTime),
						lte(schema.meeting.scheduledAt, now),
						drizzleSql`${schema.meeting.scheduledAt} + (3 * 60 * 60) > ${now}`,
					),
				),
			),
		)
		.orderBy(asc(schema.meeting.scheduledAt))
		.all();

	return c.json(
		rows.map((r) => ({
			...r,
			yes_count: Number(r.yes_count || 0),
			maybe_count: Number(r.maybe_count || 0),
			no_count: Number(r.no_count || 0),
		})),
	);
});

meetings.get("/meetings/:id/:token", async (c) => {
	const id = Number(c.req.param("id"));
	const token = c.req.param("token");

	const db = drizzle(c.env.DB);
	const user = await db
		.select({ user_id: schema.slackUser.userId })
		.from(schema.slackUser)
		.where(
			eq(schema.slackUser.calendarToken, token),
		)
		.get();

	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const row = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			my_status: schema.attendance.status,
			my_note: schema.attendance.note,
			yes_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'yes')`,
			maybe_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'maybe')`,
			no_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'no')`,
		})
		.from(schema.meeting)
		.leftJoin(
			schema.attendance,
			and(
				eq(schema.attendance.meetingId, schema.meeting.id),
				eq(schema.attendance.userId, user.user_id),
			),
		)
		.where(eq(schema.meeting.id, id))
		.get();

	if (!row) return c.json({ error: "Not found" }, 404);

	return c.json({
		...row,
		yes_count: Number(row.yes_count || 0),
		maybe_count: Number(row.maybe_count || 0),
		no_count: Number(row.no_count || 0),
	});
});

meetings.get("/meetings/past", requireSession(), async (c) => {
	// biome-ignore lint/style/noNonNullAssertion: guaranteed by requireSession
	const session = c.get("session")!;
	const limit = parseInt(c.req.query("limit") || "20", 10);
	const offset = parseInt(c.req.query("offset") || "0", 10);
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			my_status: schema.attendance.status,
			my_note: schema.attendance.note,
			yes_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'yes')`,
			maybe_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'maybe')`,
			no_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'no')`,
		})
		.from(schema.meeting)
		.leftJoin(
			schema.attendance,
			and(
				eq(schema.attendance.meetingId, schema.meeting.id),
				eq(schema.attendance.userId, session.user_id),
			),
		)
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
		.orderBy(desc(schema.meeting.scheduledAt))
		.limit(limit)
		.offset(offset)
		.all();

	return c.json(
		rows.map((r) => ({
			...r,
			yes_count: Number(r.yes_count || 0),
			maybe_count: Number(r.maybe_count || 0),
			no_count: Number(r.no_count || 0),
		})),
	);
});

meetings.get("/meetings/:id", requireSession(), async (c) => {
	// biome-ignore lint/style/noNonNullAssertion: requireSession() middleware guarantees session exists
	const session = c.get("session")!;
	const id = Number(c.req.param("id"));
	const db = drizzle(c.env.DB);
	const row = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			my_status: schema.attendance.status,
			my_note: schema.attendance.note,
			yes_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'yes')`,
			maybe_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'maybe')`,
			no_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'no')`,
		})
		.from(schema.meeting)
		.leftJoin(
			schema.attendance,
			and(
				eq(schema.attendance.meetingId, schema.meeting.id),
				eq(schema.attendance.userId, session.user_id),
			),
		)
		.where(eq(schema.meeting.id, id))
		.get();

	if (!row) return c.json({ error: "Not found" }, 404);

	return c.json({
		...row,
		yes_count: Number(row.yes_count || 0),
		maybe_count: Number(row.maybe_count || 0),
		no_count: Number(row.no_count || 0),
	});
});

meetings.post("/rsvp/:meetingId/:token", async (c) => {
	const token = c.req.param("token");
	const meetingId = Number(c.req.param("meetingId"));
	const { status, note = "" } = await c.req.json<{
		status: string;
		note?: string;
	}>();

	if (!["yes", "maybe", "no"].includes(status))
		return c.json({ error: "Invalid status" }, 400);

	const db = drizzle(c.env.DB);
	const user = await db
		.select({ user_id: schema.slackUser.userId })
		.from(schema.slackUser)
		.where(
			eq(schema.slackUser.calendarToken, token),
		)
		.get();

	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const now = Math.floor(Date.now() / 1000);

	await db
		.insert(schema.attendance)
		.values({
			meetingId,
			userId: user.user_id,
			// biome-ignore lint/suspicious/noExplicitAny: status is validated above
			status: status as any,
			note,
		})
		.onConflictDoUpdate({
			target: [schema.attendance.meetingId, schema.attendance.userId],
			// biome-ignore lint/suspicious/noExplicitAny: status is validated above
			set: { status: status as any, note },
		});

	await db
		.insert(schema.pendingAnnouncement)
		.values({ meetingId, queuedAt: now })
		.onConflictDoUpdate({
			target: schema.pendingAnnouncement.meetingId,
			set: { queuedAt: now },
		});

	return c.json({ ok: true });
});

meetings.post("/rsvp/:meetingId", requireSession(), async (c) => {
	// biome-ignore lint/style/noNonNullAssertion: guaranteed by requireSession
	const session = c.get("session")!;
	const meetingId = Number(c.req.param("meetingId"));
	const { status, note = "" } = await c.req.json<{
		status: string;
		note?: string;
	}>();
	if (!["yes", "maybe", "no"].includes(status))
		return c.json({ error: "Invalid status" }, 400);

	const db = drizzle(c.env.DB);
	const now = Math.floor(Date.now() / 1000);

	await db
		.insert(schema.attendance)
		.values({
			meetingId,
			userId: session.user_id,
			// biome-ignore lint/suspicious/noExplicitAny: status is validated above
			status: status as any,
			note,
		})
		.onConflictDoUpdate({
			target: [schema.attendance.meetingId, schema.attendance.userId],
			// biome-ignore lint/suspicious/noExplicitAny: status is validated above
			set: { status: status as any, note },
		});

	await db
		.insert(schema.pendingAnnouncement)
		.values({ meetingId, queuedAt: now })
		.onConflictDoUpdate({
			target: schema.pendingAnnouncement.meetingId,
			set: { queuedAt: now },
		});

	return c.json({ ok: true });
});

export default meetings;
