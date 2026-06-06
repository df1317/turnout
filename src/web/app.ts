import { and, count, sql as drizzleSql, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../db/schema";
import type { Env } from "../index";
import type { Session } from "./middleware/session";
import { requireSession, sessionMiddleware } from "./middleware/session";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import calendarRoutes from "./routes/calendar";
import meetingsRoutes from "./routes/meetings";
import teamsnapRoutes from "./routes/teamsnap";

type Variables = { session: Session | null };

export function createWebApp(_env: Env) {
	const app = new Hono<{ Bindings: Env; Variables: Variables }>();

	// Server-side auth (must stay here — sets httpOnly cookies)
	app.route("/api/auth", authRoutes);

	// Public calendar feed
	app.route("/api/calendar", calendarRoutes);

	// Add session middleware to teamsnap routes, then mount them
	app.use("/api/teamsnap/*", sessionMiddleware);
	app.route("/api/teamsnap", teamsnapRoutes);

	// Meetings + RSVP routes (session middleware applied internally)
	app.route("/api", meetingsRoutes);

	// Admin routes (requireAdmin applied internally)
	app.route("/api/admin", adminRoutes);

	// JSON API — small user/cdt endpoints
	const api = new Hono<{ Bindings: Env; Variables: Variables }>();

	api.use("*", sessionMiddleware);

	api.get("/me", requireSession(), (c) => {
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by requireSession
		const s = c.get("session")!;
		return c.json({
			user_id: s.user_id,
			name: s.name,
			avatar_url: s.avatar_url,
			is_admin: s.is_admin === 1,
			role: s.role,
			calendar_token: s.calendar_token,
		});
	});

	api.get("/me/punchcard", requireSession(), async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by requireSession
		const session = c.get("session")!;
		const now = Math.floor(Date.now() / 1000);

		const db = drizzle(c.env.DB);
		const rows = await db
			.select({ scheduled_at: schema.meeting.scheduledAt })
			.from(schema.attendance)
			.innerJoin(
				schema.meeting,
				eq(schema.attendance.meetingId, schema.meeting.id),
			)
			.where(
				and(
					eq(schema.attendance.userId, session.user_id),
					eq(schema.attendance.status, "yes"),
					drizzleSql`${schema.meeting.scheduledAt} < ${now}`,
					eq(schema.meeting.cancelled, 0),
				),
			)
			.all();

		return c.json(rows);
	});

	api.get("/users", requireSession(), async (c) => {
		const db = drizzle(c.env.DB);
		const rows = await db
			.select({
				user_id: schema.slackUser.userId,
				name: schema.slackUser.name,
				avatar_url: schema.slackUser.avatarUrl,
				role: schema.slackUser.role,
				is_admin: schema.slackUser.isAdmin,
				cdt_id: schema.cdtMember.cdtId,
				cdt_name: schema.cdt.name,
				meetings_attended:
					drizzleSql<number>`(SELECT COUNT(*) FROM attendance a WHERE a.user_id = ${schema.slackUser.userId} AND a.status = 'yes')`.as(
						"meetings_attended",
					),
			})
			.from(schema.slackUser)
			.leftJoin(
				schema.cdtMember,
				eq(schema.cdtMember.userId, schema.slackUser.userId),
			)
			.leftJoin(schema.cdt, eq(schema.cdt.id, schema.cdtMember.cdtId))
			.orderBy(drizzleSql`${schema.slackUser.name} COLLATE NOCASE`)
			.all();

		c.header("Cache-Control", "no-store, max-age=0");
		return c.json(rows.map((r) => ({ ...r, is_admin: r.is_admin === 1 })));
	});

	api.get("/cdts", requireSession(), async (c) => {
		const db = drizzle(c.env.DB);
		const rows = await db
			.select({
				id: schema.cdt.id,
				name: schema.cdt.name,
				handle: schema.cdt.handle,
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

	api.get("/users/:userId/punchcard", requireSession(), async (c) => {
		const userId = c.req.param("userId");
		const now = Math.floor(Date.now() / 1000);
		const db = drizzle(c.env.DB);
		const rows = await db
			.select({ scheduled_at: schema.meeting.scheduledAt })
			.from(schema.attendance)
			.innerJoin(
				schema.meeting,
				eq(schema.meeting.id, schema.attendance.meetingId),
			)
			.where(
				and(
					eq(schema.attendance.userId, userId),
					eq(schema.attendance.status, "yes"),
					drizzleSql`${schema.meeting.scheduledAt} < ${now}`,
					eq(schema.meeting.cancelled, 0),
				),
			)
			.all();

		return c.json(rows);
	});

	app.route("/api", api);

	return app;
}
