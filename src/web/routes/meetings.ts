import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../../db/schema";
import type { Env } from "../../index";
import {
	pastMeetingFilter,
	selectMeetingByIdWithCounts,
	selectMeetingsWithCounts,
	upcomingMeetingFilter,
} from "../../lib/meeting-queries";
import { isValidRsvpStatus, recordRsvp } from "../../lib/rsvp";
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

	const rows = await selectMeetingsWithCounts(db, {
		where: upcomingMeetingFilter(now),
		userId: session.user_id,
	});

	return c.json(rows);
});

meetings.get("/meetings/:id/:token", async (c) => {
	const id = Number(c.req.param("id"));
	const token = c.req.param("token");

	const db = drizzle(c.env.DB);
	// calendarToken is always uppercase hex from hex(randomblob(16))
	const user = await db
		.select({ user_id: schema.slackUser.userId })
		.from(schema.slackUser)
		.where(eq(schema.slackUser.calendarToken, token))
		.get();

	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const row = await selectMeetingByIdWithCounts(db, id, user.user_id);
	if (!row) return c.json({ error: "Not found" }, 404);

	return c.json(row);
});

meetings.get("/meetings/past", requireSession(), async (c) => {
	// biome-ignore lint/style/noNonNullAssertion: guaranteed by requireSession
	const session = c.get("session")!;
	const limit = parseInt(c.req.query("limit") || "20", 10);
	const offset = parseInt(c.req.query("offset") || "0", 10);
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);

	const rows = await selectMeetingsWithCounts(db, {
		where: pastMeetingFilter(now),
		userId: session.user_id,
		orderBy: "desc",
		limit,
		offset,
	});

	return c.json(rows);
});

meetings.get("/meetings/:id", requireSession(), async (c) => {
	// biome-ignore lint/style/noNonNullAssertion: requireSession() middleware guarantees session exists
	const session = c.get("session")!;
	const id = Number(c.req.param("id"));
	const db = drizzle(c.env.DB);

	const row = await selectMeetingByIdWithCounts(db, id, session.user_id);
	if (!row) return c.json({ error: "Not found" }, 404);

	return c.json(row);
});

meetings.post("/rsvp/:meetingId/:token", async (c) => {
	const token = c.req.param("token");
	const meetingId = Number(c.req.param("meetingId"));
	const { status, note = "" } = await c.req.json<{
		status: string;
		note?: string;
	}>();

	if (!isValidRsvpStatus(status))
		return c.json({ error: "Invalid status" }, 400);

	const db = drizzle(c.env.DB);
	// calendarToken is always uppercase hex from hex(randomblob(16))
	const user = await db
		.select({ user_id: schema.slackUser.userId })
		.from(schema.slackUser)
		.where(eq(schema.slackUser.calendarToken, token))
		.get();

	if (!user) return c.json({ error: "Unauthorized" }, 401);

	await recordRsvp(db, meetingId, user.user_id, status, note);
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

	if (!isValidRsvpStatus(status))
		return c.json({ error: "Invalid status" }, 400);

	const db = drizzle(c.env.DB);
	await recordRsvp(db, meetingId, session.user_id, status, note);
	return c.json({ ok: true });
});

export default meetings;
