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

	const isDryRun = c.req.query("dryRun") === "true";

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
			const isEvent = item.href.includes("/events/");
			const isMember = item.href.includes("/members/");

			if (isEvent) {
				const data = extractData(item);
				const startDateStr = data.start_date as string;
				if (!startDateStr) continue;

				const startDate = new Date(startDateStr).getTime();
				if (startDate > cutoffMs && startDate < Date.now()) {
					events.push(data);
				}
			} else if (isMember) {
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
			if (item.href.includes("/availabilities/")) {
				availabilities.push(extractData(item));
			}
		}

		// 3. Match Members to our Slack DB
		const slackUsers = await c.env.DB.prepare(
			"SELECT user_id, name, role FROM slack_user",
		).all();

		const matchedMembers: {
			id: number;
			name: string;
			matched_user_id: string;
			manual: boolean;
		}[] = [];
		const tsToSlackUserMap = new Map<number, string>();
		const unmatchedMembers: {
			id: number;
			name: string;
			suggestedMatches: { user_id: string; name: string }[];
		}[] = [];

		for (const member of members) {
			const firstName = (member.first_name || "").trim();
			const lastName = (member.last_name || "").trim();
			const tsName = `${firstName} ${lastName}`.trim();

			// First check manual mappings
			if (manualMappings[member.id] && manualMappings[member.id] !== "ignore") {
				tsToSlackUserMap.set(member.id, manualMappings[member.id]);
				matchedMembers.push({
					id: member.id,
					name: tsName,
					matched_user_id: manualMappings[member.id],
					manual: true,
				});
				continue;
			}
			if (manualMappings[member.id] === "ignore") {
				continue;
			}

			// Then try auto-matching
			const tsNameLower = tsName.toLowerCase();
			const firstNameLower = firstName.toLowerCase();
			const lastNameLower = lastName.toLowerCase();

			const match = slackUsers.results.find(
				(u) =>
					(u.name as string).toLowerCase() === tsNameLower ||
					(u.name as string).toLowerCase().includes(tsNameLower),
			);

			if (match) {
				tsToSlackUserMap.set(member.id, match.user_id as string);
				matchedMembers.push({
					id: member.id,
					name: tsName,
					matched_user_id: match.user_id as string,
					manual: false,
				});
			} else {
				// Find partial matches for suggestions
				const suggestions = slackUsers.results
					.filter((u) => {
						const uName = (u.name as string).toLowerCase();
						const lastWord = uName.split(" ").pop();

						return (
							(firstNameLower && uName.includes(firstNameLower)) ||
							(lastNameLower && uName.includes(lastNameLower)) ||
							(lastNameLower &&
								lastWord &&
								lastWord.startsWith(lastNameLower.substring(0, 3)))
						);
					})
					.map((u) => ({
						user_id: u.user_id as string,
						name: u.name as string,
					}))
					.slice(0, 5); // Limit to top 5 suggestions

				unmatchedMembers.push({
					id: member.id,
					name: tsName,
					suggestedMatches: suggestions,
				});
			}
		}

		if (isDryRun) {
			return c.json({
				success: true,
				message: "Dry run complete",
				stats: {
					timeFrameDays,
					eventsFound: events.length,
					membersFound: members.length,
					matchedUsers: tsToSlackUserMap.size,
				},
				matchedMembers,
				unmatchedMembers,
				slackUsers: slackUsers.results
					.map((u) => ({
						user_id: u.user_id as string,
						name: u.name as string,
					}))
					.sort((a, b) => a.name.localeCompare(b.name)),
			});
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
		  ON CONFLICT(channel_id, scheduled_at) DO NOTHING
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

		const stats = {
			timeFrameDays,
			eventsFound: events.length,
			membersFound: members.length,
			matchedUsers: tsToSlackUserMap.size,
			unmatchedUsers: unmatchedMembers.length,
			attendanceRecordsInserted: attendanceInserted,
			lastSyncTime: Date.now(),
		};

		await c.env.DB.prepare(
			"INSERT INTO kv_store (key, value) VALUES ('teamsnap_last_sync_stats', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
			.bind(JSON.stringify(stats))
			.run();

		return c.json({
			success: true,
			message: "Imported past events",
			stats,
			unmatchedMembers,
			matchedMembers,
			slackUsers: slackUsers.results
				.map((u) => ({
					user_id: u.user_id,
					name: u.name,
				}))
				.sort((a, b) => (a.name as string).localeCompare(b.name as string)),
		});
		// biome-ignore lint/suspicious/noExplicitAny: D1 / fetch errors
	} catch (error: any) {
		return c.json({ error: error.message }, 500);
	}
});

export default teamsnap;
