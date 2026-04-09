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
import * as schema from "../db/schema";
import type { Env } from "../index";
import {
	buildAnnouncementBlocks,
	updateAnnouncement,
} from "../lib/announcements";
import {
	clearCdtProfile,
	deleteSlackUsergroup,
	sendWelcomeMessage,
	syncCdtUsers,
} from "../lib/slack-cdt";
import { syncAllUsers } from "./lib/sync";
import type { Session } from "./middleware/session";
import {
	requireAdmin,
	requireSession,
	sessionMiddleware,
} from "./middleware/session";
import authRoutes from "./routes/auth";
import teamsnapRoutes from "./routes/teamsnap";

type Variables = { session: Session | null };

const slugify = (name: string) =>
	`${name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")}-cdt`;

export function createWebApp(_env: Env) {
	const app = new Hono<{ Bindings: Env; Variables: Variables }>();

	// Server-side auth (must stay here — sets httpOnly cookies)
	app.route("/api/auth", authRoutes);

	// Add session middleware to teamsnap routes, then mount them
	app.use("/api/teamsnap/*", sessionMiddleware);
	app.route("/api/teamsnap", teamsnapRoutes);

	// Public calendar feed
	app.get("/api/calendar/:filename", async (c) => {
		const filename = c.req.param("filename");
		const token = filename?.replace(/\.ics$/, "");
		if (!token) return c.text("Not found", 404);

		const db = drizzle(c.env.DB);
		const user = await db
			.select({ user_id: schema.slackUser.userId, name: schema.slackUser.name })
			.from(schema.slackUser)
			.where(
				drizzleSql`LOWER(${schema.slackUser.calendarToken}) = LOWER(${token})`,
			)
			.get();

		if (!user) return c.text("Not found", 404);

		const meetings = await db
			.select({
				id: schema.meeting.id,
				name: schema.meeting.name,
				description: schema.meeting.description,
				scheduled_at: schema.meeting.scheduledAt,
				end_time: schema.meeting.endTime,
				cancelled: schema.meeting.cancelled,
			})
			.from(schema.meeting)
			.orderBy(asc(schema.meeting.scheduledAt));

		let ics = "BEGIN:VCALENDAR\r\n";
		ics += "VERSION:2.0\r\n";
		ics += "PRODID:-//Turnout//Calendar//EN\r\n";
		ics += "CALSCALE:GREGORIAN\r\n";
		ics += "METHOD:PUBLISH\r\n";
		ics += `X-WR-CALNAME:Turnout Events (${user.name})\r\n`;

		const now = `${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
		const baseUrl = new URL(c.req.url).origin;

		for (const m of meetings) {
			const start = `${
				new Date(m.scheduled_at * 1000)
					.toISOString()
					.replace(/[-:]/g, "")
					.split(".")[0]
			}Z`;

			// Default to 3 hours if no end time is specified
			const endTimeSeconds = m.end_time || m.scheduled_at + 3 * 60 * 60;
			const end = `${
				new Date(endTimeSeconds * 1000)
					.toISOString()
					.replace(/[-:]/g, "")
					.split(".")[0]
			}Z`;

			ics += "BEGIN:VEVENT\r\n";
			ics += `DTSTAMP:${now}\r\n`;
			ics += `UID:turnout-event-${m.scheduled_at}-${encodeURIComponent(m.name.replace(/\s+/g, "-"))}@turnout\r\n`;
			ics += `DTSTART:${start}\r\n`;
			ics += `DTEND:${end}\r\n`;
			ics += `SUMMARY:${m.cancelled === 1 ? "[CANCELED] " : ""}${m.name.replace(/\r?\n/g, "\\n")}\r\n`;

			let desc = m.description || "";
			if (m.cancelled !== 1) {
				const rsvpLinks = `\\n\\nRSVP Here: ${baseUrl}/rsvp/${m.id}/${token}`;
				desc += rsvpLinks;
			}

			if (desc) {
				ics += `DESCRIPTION:${desc.replace(/\r?\n/g, "\\n")}\r\n`;
			}

			if (m.cancelled === 1) {
				ics += "STATUS:CANCELLED\r\n";
			} else {
				ics += "STATUS:CONFIRMED\r\n";
			}

			ics += "END:VEVENT\r\n";
		}

		ics += "END:VCALENDAR";

		return c.text(ics, 200, {
			"Content-Type": "text/calendar; charset=utf-8",
			"Content-Disposition": 'inline; filename="calendar.ics"',
			"Cache-Control": "no-cache",
		});
	});

	// JSON API
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

	api.get("/meetings", requireSession(), async (c) => {
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

	api.get("/meetings/:id/:token", async (c) => {
		const id = Number(c.req.param("id"));
		const token = c.req.param("token");

		const db = drizzle(c.env.DB);
		const user = await db
			.select({ user_id: schema.slackUser.userId })
			.from(schema.slackUser)
			.where(
				drizzleSql`LOWER(${schema.slackUser.calendarToken}) = LOWER(${token})`,
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

	api.get("/meetings/past", requireSession(), async (c) => {
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

	api.get("/meetings/:id", requireSession(), async (c) => {
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

	api.post("/rsvp/:meetingId/:token", async (c) => {
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
				drizzleSql`LOWER(${schema.slackUser.calendarToken}) = LOWER(${token})`,
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

	api.post("/rsvp/:meetingId", requireSession(), async (c) => {
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

	// Admin API
	api.post("/admin/users/bulk/role", requireAdmin(), async (c) => {
		const { user_ids, role } = await c.req.json<{
			user_ids: string[];
			role: string | null;
		}>();
		if (!user_ids?.length)
			return c.json({ error: "No user IDs provided" }, 400);
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

	api.post("/admin/users/bulk/cdt", requireAdmin(), async (c) => {
		const { user_ids, cdt_id } = await c.req.json<{
			user_ids: string[];
			cdt_id: string | null;
		}>();
		if (!user_ids?.length)
			return c.json({ error: "No user IDs provided" }, 400);

		const db = drizzle(c.env.DB);
		const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);

		if (cdt_id === null) {
			for (const id of user_ids) {
				const currentCdt = await db
					.select({ cdt_id: schema.cdtMember.cdtId })
					.from(schema.cdtMember)
					.where(eq(schema.cdtMember.userId, id))
					.get();

				await db
					.delete(schema.cdtMember)
					.where(eq(schema.cdtMember.userId, id));
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

	api.post("/admin/users/:userId/role", requireAdmin(), async (c) => {
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

	api.get("/admin/users/:userId/meetings", requireAdmin(), async (c) => {
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

	api.post("/admin/users/:userId/cdt", requireAdmin(), async (c) => {
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

	api.get("/admin/cdts", requireAdmin(), async (c) => {
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

	api.get("/admin/cdts/:id", requireAdmin(), async (c) => {
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

	api.post("/admin/cdts", requireAdmin(), async (c) => {
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

	api.put("/admin/cdts/:id", requireAdmin(), async (c) => {
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

	api.delete("/admin/cdts/:id", requireAdmin(), async (c) => {
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

	api.get("/admin/meetings", requireAdmin(), async (c) => {
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
					and(
						isNotNull(schema.meeting.endTime),
						gt(schema.meeting.endTime, now),
					),
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

	api.get("/admin/meetings/:id/attendance", requireAdmin(), async (c) => {
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

	api.post("/admin/meetings", requireAdmin(), async (c) => {
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
			await botClient.conversations
				.join({ channel: channel_id })
				.catch(() => {});
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

	api.put("/admin/meetings/:id", requireAdmin(), async (c) => {
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
		if (body.description !== undefined)
			updateSet.description = body.description;
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

	api.post("/admin/meetings/:id/cancel", requireAdmin(), async (c) => {
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

	api.post("/admin/meetings/series", requireAdmin(), async (c) => {
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

		const { generateDates } = await import("../lib/recurrence");
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

	api.post("/admin/meetings/import-ics", requireAdmin(), async (c) => {
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

	api.delete("/admin/meetings/:id", requireAdmin(), async (c) => {
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

	api.post("/admin/sync", requireAdmin(), async (c) => {
		await syncAllUsers(c.env.DB, c.env.SLACK_ADMIN_TOKEN);
		return c.json({ ok: true });
	});

	api.post("/admin/queue-announcements", requireAdmin(), async (c) => {
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

	api.post("/admin/clear-db", requireAdmin(), async (c) => {
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

	api.get("/admin/stats", requireAdmin(), async (c) => {
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

	api.get("/admin/settings/:key", requireAdmin(), async (c) => {
		const key = c.req.param("key");
		const db = drizzle(c.env.DB);
		const row = await db
			.select({ value: schema.kvStore.value })
			.from(schema.kvStore)
			.where(eq(schema.kvStore.key, key))
			.get();
		return c.json({ value: row?.value ?? null });
	});

	api.post("/admin/settings/:key", requireAdmin(), async (c) => {
		const key = c.req.param("key");
		const { value } = await c.req.json<{ value: string }>();
		const db = drizzle(c.env.DB);
		await db
			.insert(schema.kvStore)
			.values({ key, value })
			.onConflictDoUpdate({ target: schema.kvStore.key, set: { value } });
		return c.json({ ok: true });
	});

	api.get("/admin/slack/channels", requireAdmin(), async (c) => {
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

	app.route("/api", api);

	return app;
}
