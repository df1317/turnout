import { Hono } from "hono";
import type { Env } from "../../index";
import { TeamSnapClient } from "../../lib/teamsnap/client";
import { extractData } from "../../lib/teamsnap/types";
import { requireAdmin } from "../middleware/session";

const teamsnap = new Hono<{ Bindings: Env }>();

teamsnap.get("/sync", requireAdmin(), async (c) => {
	const token = (await c.env.DB.prepare(
		"SELECT value FROM kv_store WHERE key = 'teamsnap_token'",
	).first("value")) as string;
	const teamIdStr = (await c.env.DB.prepare(
		"SELECT value FROM kv_store WHERE key = 'teamsnap_team_id'",
	).first("value")) as string;

	if (!token || !teamIdStr)
		return c.json(
			{ error: "No TeamSnap token or team ID configured in kv_store" },
			400,
		);

	const client = new TeamSnapClient(token, teamIdStr);
	const timeFrameDays = Number(c.req.query("days") || 30);
	const cutoffTime = new Date();
	cutoffTime.setDate(cutoffTime.getDate() - timeFrameDays);
	const cutoffMs = cutoffTime.getTime();

	// Parse manual mappings passed from UI
	const manualMappingsStr = c.req.query("mappings");
	const manualMappings: Record<string, string> = manualMappingsStr
		? JSON.parse(manualMappingsStr)
		: {};

	try {
		const { collection } = await client.getBulkLoad();

		// 1. Extract Events and Members
		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		const events: Record<string, any>[] = [];
		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		const members: Record<string, any>[] = [];

		for (const item of collection.items) {
			const typeLink = item.links?.find((l) => l.rel === "type");
			if (!typeLink) continue;

			const type = typeLink.href.split("/").pop() || "";
			if (type === "event") {
				const data = extractData(item);
				const startDate = new Date(data.start_date as string).getTime();
				if (startDate > cutoffMs && startDate < Date.now()) {
					events.push(data);
				}
			} else if (type === "member") {
				members.push(extractData(item));
			}
		}

		if (events.length === 0)
			return c.json({ message: "No events in timeframe" });

		// 2. Fetch Availabilities
		const { collection: availCollection } = await client.getAvailabilities();
		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		const availabilities: Record<string, any>[] = [];
		for (const item of availCollection.items) {
			const typeLink = item.links?.find((l) => l.rel === "type");
			if (typeLink?.href.endsWith("/availability")) {
				availabilities.push(extractData(item));
			}
		}

		// 3. Match Members to our Slack DB
		const slackUsers = await c.env.DB.prepare(
			"SELECT user_id, name, role FROM slack_user",
		).all();

		const tsToSlackUserMap = new Map<number, string>();
		const unmatchedMembers: { id: number; name: string }[] = [];

		for (const member of members) {
			const tsName =
				`${member.first_name || ""} ${member.last_name || ""}`.trim();

			// First check manual mappings
			if (manualMappings[member.id] && manualMappings[member.id] !== "ignore") {
				tsToSlackUserMap.set(member.id, manualMappings[member.id]);
				continue;
			}
			if (manualMappings[member.id] === "ignore") {
				continue;
			}

			// Then try auto-matching
			const tsNameLower = tsName.toLowerCase();
			const match = slackUsers.results.find(
				(u) =>
					(u.name as string).toLowerCase() === tsNameLower ||
					(u.name as string).toLowerCase().includes(tsNameLower),
			);

			if (match) {
				tsToSlackUserMap.set(member.id, match.user_id as string);
			} else {
				unmatchedMembers.push({
					id: member.id,
					name: tsName,
				});
			}
		}

		// 4. Upsert Meetings
		const statements: D1PreparedStatement[] = [];
		for (const event of events) {
			const scheduledAt = Math.floor(
				new Date(event.start_date).getTime() / 1000,
			);
			const name = event.name || "Team Meeting";

			statements.push(
				c.env.DB.prepare(`
          INSERT INTO meeting (name, scheduled_at, channel_id, message_ts)
          VALUES (?, ?, 'teamsnap-import', 'none')
        `).bind(name, scheduledAt),
			);
		}

		if (statements.length > 0) {
			await c.env.DB.batch(statements);
			statements.length = 0;
		}

		const allMeetingsRes = await c.env.DB.prepare(
			"SELECT id, name, scheduled_at FROM meeting WHERE channel_id = 'teamsnap-import'",
		).all();
		const meetingMap = new Map(
			allMeetingsRes.results.map((m) => [`${m.name}-${m.scheduled_at}`, m.id]),
		);

		let attendanceInserted = 0;
		for (const avail of availabilities) {
			const tsEventId = avail.event_id;
			const tsMemberId = avail.member_id;
			const statusCode = avail.status_code;

			const tsEvent = events.find((e) => e.id === tsEventId);
			if (!tsEvent) continue;

			const scheduledAt = Math.floor(
				new Date(tsEvent.start_date).getTime() / 1000,
			);
			const meetingId = meetingMap.get(
				`${tsEvent.name || "Team Meeting"}-${scheduledAt}`,
			);
			const slackUserId = tsToSlackUserMap.get(tsMemberId);

			if (meetingId && slackUserId) {
				let status = "maybe";
				if (statusCode === 1) status = "yes";
				if (statusCode === 0) status = "no";

				statements.push(
					c.env.DB.prepare(`
            INSERT INTO attendance (meeting_id, user_id, status)
            VALUES (?, ?, ?)
            ON CONFLICT(meeting_id, user_id) DO UPDATE SET status = excluded.status
          `).bind(meetingId, slackUserId, status),
				);
				attendanceInserted++;
			}
		}

		if (statements.length > 0) {
			await c.env.DB.batch(statements);
		}

		return c.json({
			success: true,
			message: "Imported past events",
			stats: {
				timeFrameDays,
				eventsFound: events.length,
				membersFound: members.length,
				matchedUsers: tsToSlackUserMap.size,
				attendanceRecordsInserted: attendanceInserted,
			},
			unmatchedMembers,
			slackUsers: slackUsers.results.map((u) => ({
				user_id: u.user_id,
				name: u.name,
			})),
		});
		// biome-ignore lint/suspicious/noExplicitAny: D1 / fetch errors
	} catch (error: any) {
		return c.json({ error: error.message }, 500);
	}
});

export default teamsnap;
