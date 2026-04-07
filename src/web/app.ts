import { Hono } from "hono";
import type { Env } from "../index";
import type { Session } from "./middleware/session";
import {
	sessionMiddleware,
	requireSession,
	requireAdmin,
} from "./middleware/session";
import { syncAllUsers } from "./lib/sync";
import {
	updateAnnouncement,
	buildAnnouncementBlocks,
} from "../lib/announcements";
import { SlackAPIClient } from "slack-web-api-client";
import authRoutes from "./routes/auth";

type Variables = { session: Session | null };

const slugify = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "") + "-cdt";

export function createWebApp(env: Env) {
	const app = new Hono<{ Bindings: Env; Variables: Variables }>();

	// Server-side auth (must stay here — sets httpOnly cookies)
	app.route("/", authRoutes);

	// JSON API
	const api = new Hono<{ Bindings: Env; Variables: Variables }>();
	api.use("*", sessionMiddleware);

	api.get("/me", requireSession(), (c) => {
		const s = c.get("session")!;
		return c.json({
			user_id: s.user_id,
			name: s.name,
			avatar_url: s.avatar_url,
			is_admin: s.is_admin === 1,
			role: s.role,
		});
	});

	api.get("/users", requireSession(), async (c) => {
		const rows = await c.env.DB.prepare(
			`SELECT u.user_id, u.name, u.avatar_url, u.role, u.is_admin,
              cm.cdt_id, cdt.name AS cdt_name
       FROM slack_user u
       LEFT JOIN cdt_member cm ON cm.user_id = u.user_id
       LEFT JOIN cdt ON cdt.id = cm.cdt_id
       ORDER BY u.name COLLATE NOCASE`,
		).all<{
			user_id: string;
			name: string;
			avatar_url: string;
			role: string | null;
			is_admin: number;
			cdt_id: string | null;
			cdt_name: string | null;
		}>();
		
		c.header("Cache-Control", "no-store, max-age=0");
		return c.json(
			rows.results.map((r) => ({
				...r,
				is_admin: r.is_admin === 1,
			})),
		);
	});

	api.get("/cdts", requireSession(), async (c) => {
		const rows = await c.env.DB.prepare(
			`SELECT c.id, c.name, c.handle,
              COUNT(cm.user_id) AS member_count
       FROM cdt c
       LEFT JOIN cdt_member cm ON cm.cdt_id = c.id
       GROUP BY c.id
       ORDER BY c.name COLLATE NOCASE`,
		).all<{ id: string; name: string; handle: string; member_count: number }>();
		return c.json(rows.results);
	});

	api.get("/meetings", requireSession(), async (c) => {
		const session = c.get("session")!;
		const now = Math.floor(Date.now() / 1000);
		const rows = await c.env.DB.prepare(
			`SELECT m.id, m.name, m.description, m.scheduled_at, m.end_time, a.status AS my_status, a.note AS my_note,
              (SELECT COUNT(*) FROM attendance WHERE meeting_id = m.id AND status = 'yes') AS yes_count,
              (SELECT COUNT(*) FROM attendance WHERE meeting_id = m.id AND status = 'maybe') AS maybe_count,
              (SELECT COUNT(*) FROM attendance WHERE meeting_id = m.id AND status = 'no') AS no_count
       FROM meeting m
       LEFT JOIN attendance a ON a.meeting_id = m.id AND a.user_id = ?
       WHERE m.scheduled_at > ? AND m.cancelled = 0
       ORDER BY m.scheduled_at LIMIT 10`,
		)
			.bind(session.user_id, now)
			.all();
		return c.json(rows.results);
	});

	api.post("/rsvp/:meetingId", requireSession(), async (c) => {
		const session = c.get("session")!;
		const meetingId = Number(c.req.param("meetingId"));
		const { status, note = "" } = await c.req.json<{
			status: string;
			note?: string;
		}>();
		if (!["yes", "maybe", "no"].includes(status))
			return c.json({ error: "Invalid status" }, 400);

		await c.env.DB.prepare(
			`INSERT INTO attendance (meeting_id, user_id, status, note)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = excluded.status, note = excluded.note`,
		)
			.bind(meetingId, session.user_id, status, note)
			.run();

		const meeting = await c.env.DB.prepare(
			"SELECT id, name, description, scheduled_at, end_time, channel_id, message_ts, cancelled FROM meeting WHERE id = ?",
		)
			.bind(meetingId)
			.first<{
				id: number;
				name: string;
				description: string;
				scheduled_at: number;
				end_time: number | null;
				channel_id: string;
				message_ts: string;
				cancelled: number;
			}>();

		if (meeting) {
			const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
			await updateAnnouncement(botClient, c.env.DB, meeting).catch((err) =>
				console.error("rsvp announcement update failed:", err),
			);
		}

		return c.json({ ok: true });
	});

	// Admin API
	api.post("/admin/users/:userId/role", requireAdmin(), async (c) => {
		const userId = c.req.param("userId");
		const { role } = await c.req.json<{ role: string | null }>();
		const validRoles = ["student", "mentor", "parent", "alumni"];
		if (role && !validRoles.includes(role))
			return c.json({ error: "Invalid role" }, 400);
		await c.env.DB.prepare("UPDATE slack_user SET role = ? WHERE user_id = ?")
			.bind(role ?? null, userId)
			.run();
		return c.json({ ok: true });
	});

	api.get("/admin/users/:userId/meetings", requireAdmin(), async (c) => {
		const userId = c.req.param("userId");
		const rows = await c.env.DB.prepare(
			`SELECT m.id, m.name, m.scheduled_at, m.end_time, a.status, a.note
       FROM attendance a
       JOIN meeting m ON m.id = a.meeting_id
       WHERE a.user_id = ?
       ORDER BY m.scheduled_at DESC LIMIT 20`,
		)
			.bind(userId)
			.all<{
				id: number;
				name: string;
				scheduled_at: number;
				end_time: number | null;
				status: string;
				note: string;
			}>();
		return c.json(rows.results);
	});

	api.post("/admin/users/:userId/cdt", requireAdmin(), async (c) => {
		const userId = c.req.param("userId");
		const { cdt_id } = await c.req.json<{ cdt_id: string | null }>();
		if (cdt_id === null) {
			await c.env.DB.prepare("DELETE FROM cdt_member WHERE user_id = ?")
				.bind(userId)
				.run();
		} else {
			await c.env.DB.prepare(
				`INSERT INTO cdt_member (user_id, cdt_id) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET cdt_id = excluded.cdt_id`,
			)
				.bind(userId, cdt_id)
				.run();
		}
		return c.json({ ok: true });
	});

	api.get("/admin/cdts", requireAdmin(), async (c) => {
		const rows = await c.env.DB.prepare(
			`SELECT c.id, c.name, c.handle, c.channel_id,
              COUNT(cm.user_id) AS member_count
       FROM cdt c
       LEFT JOIN cdt_member cm ON cm.cdt_id = c.id
       GROUP BY c.id
       ORDER BY c.name COLLATE NOCASE`,
		).all<{
			id: string;
			name: string;
			handle: string;
			channel_id: string;
			member_count: number;
		}>();
		return c.json(rows.results);
	});

	api.get("/admin/cdts/:id", requireAdmin(), async (c) => {
		const id = c.req.param("id");
		const cdt = await c.env.DB.prepare(
			"SELECT id, name, handle, channel_id FROM cdt WHERE id = ?",
		)
			.bind(id)
			.first<{
				id: string;
				name: string;
				handle: string;
				channel_id: string;
			}>();
		if (!cdt) return c.json({ error: "Not found" }, 404);

		const members = await c.env.DB.prepare(
			`SELECT u.user_id, u.name, u.avatar_url
       FROM cdt_member cm
       JOIN slack_user u ON u.user_id = cm.user_id
       WHERE cm.cdt_id = ?
       ORDER BY u.name COLLATE NOCASE`,
		)
			.bind(id)
			.all<{ user_id: string; name: string; avatar_url: string }>();

		return c.json({
			...cdt,
			member_count: members.results.length,
			members: members.results,
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
		const result = (await adminClient.usergroups.create({
			name,
			handle: finalHandle,
		})) as { usergroup?: { id: string } };
		const groupId = result.usergroup?.id;
		if (!groupId)
			return c.json({ error: "Failed to create Slack usergroup" }, 500);

		await c.env.DB.prepare(
			"INSERT INTO cdt (id, name, handle, channel_id) VALUES (?, ?, ?, ?)",
		)
			.bind(groupId, name, finalHandle, channel_id ?? null)
			.run();

		const cdt = await c.env.DB.prepare(
			`SELECT c.id, c.name, c.handle, c.channel_id, 0 AS member_count FROM cdt c WHERE c.id = ?`,
		)
			.bind(groupId)
			.first<{
				id: string;
				name: string;
				handle: string;
				channel_id: string;
				member_count: number;
			}>();

		return c.json(cdt, 201);
	});

	api.put("/admin/cdts/:id", requireAdmin(), async (c) => {
		const id = c.req.param("id");
		const body = await c.req.json<{ name?: string; channel_id?: string }>();
		const fields: string[] = [];
		const values: (string | null)[] = [];
		if (body.name !== undefined) {
			fields.push("name = ?");
			values.push(body.name);
		}
		if (body.channel_id !== undefined) {
			fields.push("channel_id = ?");
			values.push(body.channel_id);
		}
		if (fields.length === 0)
			return c.json({ error: "No fields to update" }, 400);
		values.push(id);
		await c.env.DB.prepare(`UPDATE cdt SET ${fields.join(", ")} WHERE id = ?`)
			.bind(...values)
			.run();
		return c.json({ ok: true });
	});

	api.delete("/admin/cdts/:id", requireAdmin(), async (c) => {
		const id = c.req.param("id");
		await c.env.DB.prepare("DELETE FROM cdt WHERE id = ?").bind(id).run();
		return c.json({ ok: true });
	});

	api.get("/admin/meetings", requireAdmin(), async (c) => {
		const rows = await c.env.DB.prepare(
			`SELECT m.id, m.name, m.description, m.scheduled_at, m.end_time, m.channel_id, m.message_ts, m.cancelled, m.series_id,
         COALESCE(SUM(CASE WHEN a.status = 'yes' THEN 1 ELSE 0 END), 0) AS yes_count,
         COALESCE(SUM(CASE WHEN a.status = 'maybe' THEN 1 ELSE 0 END), 0) AS maybe_count,
         COALESCE(SUM(CASE WHEN a.status = 'no' THEN 1 ELSE 0 END), 0) AS no_count
       FROM meeting m LEFT JOIN attendance a ON a.meeting_id = m.id
       GROUP BY m.id ORDER BY m.scheduled_at DESC LIMIT 100`,
		).all<{
			id: number;
			name: string;
			description: string;
			scheduled_at: number;
			end_time: number | null;
			channel_id: string;
			message_ts: string;
			cancelled: number;
			series_id: number | null;
			yes_count: number;
			maybe_count: number;
			no_count: number;
		}>();
		return c.json(
			rows.results.map((r) => ({ ...r, cancelled: r.cancelled === 1 })),
		);
	});

	api.get("/admin/meetings/:id/attendance", requireAdmin(), async (c) => {
		const id = Number(c.req.param("id"));
		const rows = await c.env.DB.prepare(
			`SELECT a.user_id, a.status, a.note, u.name, u.avatar_url
       FROM attendance a
       JOIN slack_user u ON u.user_id = a.user_id
       WHERE a.meeting_id = ?
       ORDER BY u.name COLLATE NOCASE`,
		)
			.bind(id)
			.all<{
				user_id: string;
				status: string;
				note: string;
				name: string;
				avatar_url: string;
			}>();
		return c.json(rows.results);
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
		if (channel_id && shouldAnnounceNow) {
			const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
			await botClient.conversations
				.join({ channel: channel_id })
				.catch(() => {});
			const blocks = buildAnnouncementBlocks(
				{ id: 0, name, description, scheduled_at, end_time: end_time ?? null },
				{ yes: [], maybe: [], no: [] },
			);
			const posted = (await botClient.chat.postMessage({
				channel: channel_id,
				text: `Meeting: ${name}`,
				blocks,
			})) as { ts?: string };
			message_ts = posted.ts ?? null;
		}

		const result = await c.env.DB.prepare(
			`INSERT INTO meeting (name, description, scheduled_at, end_time, channel_id, message_ts, cancelled)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
		)
			.bind(
				name,
				description,
				scheduled_at,
				end_time ?? null,
				channel_id ?? null,
				message_ts,
			)
			.run();

		const id = result.meta.last_row_id as number;
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
		const fields: string[] = [];
		const values: (string | number | null)[] = [];
		if (body.name !== undefined) {
			fields.push("name = ?");
			values.push(body.name);
		}
		if (body.description !== undefined) {
			fields.push("description = ?");
			values.push(body.description);
		}
		if (body.scheduled_at !== undefined) {
			fields.push("scheduled_at = ?");
			values.push(body.scheduled_at);
		}
		if (body.end_time !== undefined) {
			fields.push("end_time = ?");
			values.push(body.end_time);
		}
		if (fields.length === 0)
			return c.json({ error: "No fields to update" }, 400);
		values.push(id);
		await c.env.DB.prepare(
			`UPDATE meeting SET ${fields.join(", ")} WHERE id = ?`,
		)
			.bind(...values)
			.run();

		const meeting = await c.env.DB.prepare(
			"SELECT id, name, description, scheduled_at, channel_id, message_ts, cancelled FROM meeting WHERE id = ?",
		)
			.bind(id)
			.first<{
				id: number;
				name: string;
				description: string;
				scheduled_at: number;
				channel_id: string;
				message_ts: string;
				cancelled: number;
			}>();

		if (meeting) {
			const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
			await updateAnnouncement(botClient, c.env.DB, meeting).catch((err) =>
				console.error("meeting update announcement failed:", err),
			);
		}

		return c.json({ ok: true });
	});

	api.post("/admin/meetings/:id/cancel", requireAdmin(), async (c) => {
		const id = Number(c.req.param("id"));
		const { cancelled } = await c.req.json<{ cancelled: boolean }>();
		await c.env.DB.prepare("UPDATE meeting SET cancelled = ? WHERE id = ?")
			.bind(cancelled ? 1 : 0, id)
			.run();

		const meeting = await c.env.DB.prepare(
			"SELECT id, name, description, scheduled_at, channel_id, message_ts, cancelled FROM meeting WHERE id = ?",
		)
			.bind(id)
			.first<{
				id: number;
				name: string;
				description: string;
				scheduled_at: number;
				channel_id: string;
				message_ts: string;
				cancelled: number;
			}>();

		if (meeting) {
			const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
			await updateAnnouncement(botClient, c.env.DB, meeting).catch((err) =>
				console.error("cancel announcement update failed:", err),
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

		const seriesResult = await c.env.DB.prepare(
			`INSERT INTO meeting_series (name, description, days_of_week, time_of_day, end_date)
       VALUES (?, ?, ?, ?, ?)`,
		)
			.bind(
				name,
				description,
				JSON.stringify(days_of_week),
				time_of_day_minutes,
				end_date,
			)
			.run();
		const seriesId = seriesResult.meta.last_row_id as number;

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

			if (channel_id && shouldAnnounceNow) {
				try {
					await botClient.conversations.join({ channel: channel_id });
				} catch {}
				const blocks = buildAnnouncementBlocks(
					{ id: 0, name, description, scheduled_at: ts, end_time },
					{ yes: [], maybe: [], no: [] },
				);
				const posted = (await botClient.chat.postMessage({
					channel: channel_id,
					text: `Meeting: ${name}`,
					blocks,
				})) as { ts?: string };
				message_ts = posted.ts ?? null;
			}

			const result = await c.env.DB.prepare(
				`INSERT INTO meeting (series_id, name, description, scheduled_at, end_time, channel_id, message_ts, cancelled)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
			)
				.bind(
					seriesId,
					name,
					description,
					ts,
					end_time,
					channel_id ?? null,
					message_ts,
				)
				.run();
			created.push({
				id: result.meta.last_row_id as number,
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

	api.delete("/admin/meetings/:id", requireAdmin(), async (c) => {
		const id = Number(c.req.param("id"));
		await c.env.DB.prepare("DELETE FROM meeting WHERE id = ?").bind(id).run();
		return c.json({ ok: true });
	});

	api.post("/admin/sync", requireAdmin(), async (c) => {
		await syncAllUsers(c.env.DB, c.env.SLACK_ADMIN_TOKEN);
		return c.json({ ok: true });
	});

	api.get("/admin/slack/channels", requireAdmin(), async (c) => {
		const now = Math.floor(Date.now() / 1000);
		const cached = await c.env.DB.prepare(
			"SELECT value, expires_at FROM slack_cache WHERE key = ?",
		)
			.bind("channels")
			.first<{ value: string; expires_at: number }>();

		if (cached && cached.expires_at > now) {
			return c.json(JSON.parse(cached.value));
		}

		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		const allChannels: { id: string; name: string; is_private: boolean }[] = [];
		let cursor: string | undefined;

		do {
			const result = (await botClient.conversations.list({
				types: ["public_channel"],
				limit: 200,
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

		await c.env.DB.prepare(
			"INSERT INTO slack_cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
		)
			.bind("channels", JSON.stringify(allChannels), now + 600)
			.run();

		return c.json(allChannels);
	});

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
		
		for (const id of user_ids) {
			await c.env.DB.prepare(
				"UPDATE slack_user SET role = ? WHERE user_id = ?",
			).bind(role ?? null, id).run();
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
		if (cdt_id === null) {
			for (const id of user_ids) {
				await c.env.DB.prepare("DELETE FROM cdt_member WHERE user_id = ?").bind(id).run();
			}
		} else {
			for (const id of user_ids) {
				await c.env.DB.prepare(
					`INSERT INTO cdt_member (user_id, cdt_id) VALUES (?, ?)
           ON CONFLICT (user_id) DO UPDATE SET cdt_id = excluded.cdt_id`,
				).bind(id, cdt_id).run();
			}
		}
		return c.json({ ok: true });
	});

	app.route("/api", api);

	return app;
}
