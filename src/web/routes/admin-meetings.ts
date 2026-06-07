import {
	and,
	asc,
	sql as drizzleSql,
	eq,
	gt,
	isNotNull,
	isNull,
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
import { generateDates } from "../../lib/recurrence";
import { postWithJoin } from "../../lib/slack-utils";
import type { Session } from "../middleware/session";

type Variables = { session: Session | null };

const adminMeetings = new Hono<{ Bindings: Env; Variables: Variables }>();

adminMeetings.get("/", async (c) => {
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

adminMeetings.get("/:id/attendance", async (c) => {
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

adminMeetings.post("/", async (c) => {
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
		const blocks = buildAnnouncementBlocks(
			{ id, name, description, scheduled_at, end_time: end_time ?? null },
			{ yes: [], maybe: [], no: [] },
		);
		const posted = (await postWithJoin(botClient, channel_id, {
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

adminMeetings.put("/:id", async (c) => {
	const id = Number(c.req.param("id"));
	const body = await c.req.json<{
		name?: string;
		description?: string;
		scheduled_at?: number;
		end_time?: number | null;
	}>();

	type MeetingUpdate = Partial<typeof schema.meeting.$inferInsert>;
	const updateSet: MeetingUpdate = {};
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

adminMeetings.post("/:id/cancel", async (c) => {
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

adminMeetings.post("/series", async (c) => {
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
			const blocks = buildAnnouncementBlocks(
				{ id, name, description, scheduled_at: ts, end_time },
				{ yes: [], maybe: [], no: [] },
			);
			const posted = (await postWithJoin(botClient, channel_id, {
				channel: channel_id,
				text: `Meeting: ${name}`,
				blocks,
			}).catch(() => null)) as { ts?: string } | null;
			message_ts = posted?.ts ?? null;

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

adminMeetings.post("/import-ics", async (c) => {
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

		// Hoist settings reads outside the loop — they don't change per event
		let defaultMeetingLength = 3;
		const lengthSetting = await db
			.select({ value: schema.kvStore.value })
			.from(schema.kvStore)
			.where(eq(schema.kvStore.key, "default_meeting_length"))
			.get();
		if (lengthSetting?.value) {
			defaultMeetingLength = parseInt(lengthSetting.value, 10);
		}

		// Batch-load existing meetings for deduplication instead of querying per event
		const existingMeetings = await db
			.select({
				name: schema.meeting.name,
				scheduled_at: schema.meeting.scheduledAt,
			})
			.from(schema.meeting)
			.all();
		const existingSet = new Set(
			existingMeetings.map((m) => `${m.name}|${m.scheduled_at}`),
		);

		if (body.channel_id) {
			await botClient.conversations
				.join({ channel: body.channel_id })
				.catch(() => {});
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

			// Deduplication check against pre-loaded set
			if (existingSet.has(`${cleanName}|${scheduled_at}`)) {
				continue;
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
					const posted = (await postWithJoin(botClient, body.channel_id, {
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

adminMeetings.delete("/:id", async (c) => {
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

export default adminMeetings;
