import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { attendance, kvStore, meeting, slackUser } from "../../db/schema";
import type { Env } from "../../index";
import { TeamSnapClient } from "../../lib/teamsnap/client";
import { extractData } from "../../lib/teamsnap/types";
import { requireAdmin } from "../middleware/session";

const teamsnap = new Hono<{ Bindings: Env }>();

teamsnap.get("/sync", requireAdmin(), async (c) => {
	const db = drizzle(c.env.DB);

	const tokenRow = await db
		.select({ value: kvStore.value })
		.from(kvStore)
		.where(eq(kvStore.key, "teamsnap_token"))
		.get();
	const token = tokenRow?.value as string;

	const teamIdRow = await db
		.select({ value: kvStore.value })
		.from(kvStore)
		.where(eq(kvStore.key, "teamsnap_team_id"))
		.get();
	const teamIdStr = teamIdRow?.value as string;

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
		// Load previously saved mappings
		const savedMappingsRow = await db
			.select({ value: kvStore.value })
			.from(kvStore)
			.where(eq(kvStore.key, "teamsnap_mappings"))
			.get();
		const savedMappingsStr = savedMappingsRow?.value as string;
		const savedMappings = savedMappingsStr ? JSON.parse(savedMappingsStr) : {};

		// Merge saved mappings with any new ones from the UI
		const effectiveMappings = { ...savedMappings, ...manualMappings };

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
				if (startDate > cutoffMs) {
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
		const slackUsers = await db
			.select({
				user_id: slackUser.userId,
				name: slackUser.name,
				role: slackUser.role,
			})
			.from(slackUser)
			.all();

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
			if (
				effectiveMappings[member.id] &&
				effectiveMappings[member.id] !== "ignore"
			) {
				tsToSlackUserMap.set(member.id, effectiveMappings[member.id]);
				matchedMembers.push({
					id: member.id,
					name: tsName,
					matched_user_id: effectiveMappings[member.id],
					manual: true,
				});
				continue;
			}
			if (effectiveMappings[member.id] === "ignore") {
				continue;
			}

			// Then try auto-matching
			const tsNameLower = tsName.toLowerCase();
			const firstNameLower = firstName.toLowerCase();
			const lastNameLower = lastName.toLowerCase();

			const match = slackUsers.find(
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
				const suggestions = slackUsers
					.filter((u) => {
						const uName = (u.name as string).toLowerCase();
						const lastWord = uName.split(" ").pop();

						return (
							(firstNameLower && uName.includes(firstNameLower)) ||
							(lastNameLower && uName.includes(lastNameLower)) ||
							(lastNameLower &&
								lastWord?.startsWith(lastNameLower.substring(0, 3)))
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
				slackUsers: slackUsers
					.map((u) => ({
						user_id: u.user_id as string,
						name: u.name as string,
					}))
					.sort((a, b) => a.name.localeCompare(b.name)),
			});
		}

		// 4. Upsert Meetings
		const meetingInserts = [];
		for (const event of events) {
			const scheduledAt = Math.floor(
				new Date(event.start_date).getTime() / 1000,
			);
			const name = event.name || "Team Meeting";

			meetingInserts.push({
				name,
				scheduledAt,
				channelId: "teamsnap-import",
				messageTs: "none",
			});
		}

		if (meetingInserts.length > 0) {
			// Chunk inserts to avoid D1 max parameter limit (SQLite limit is 100 or 999 vars)
			const CHUNK_SIZE = 100;
			for (let i = 0; i < meetingInserts.length; i += CHUNK_SIZE) {
				const chunk = meetingInserts.slice(i, i + CHUNK_SIZE);
				await db.insert(meeting).values(chunk).onConflictDoNothing().run();
			}
		}

		const allMeetingsRes = await db
			.select({
				id: meeting.id,
				name: meeting.name,
				scheduled_at: meeting.scheduledAt,
			})
			.from(meeting)
			.where(eq(meeting.channelId, "teamsnap-import"))
			.all();

		const meetingMap = new Map(
			allMeetingsRes.map((m) => [`${m.name}-${m.scheduled_at}`, m.id]),
		);

		let attendanceInserted = 0;
		const attendanceInserts = [];
		for (const avail of availabilities) {
			const tsEventId = avail.event_id;
			const tsMemberId = avail.member_id;
			const statusCode = avail.status_code;

			// If it's a "has not responded" (null) or "did not attend" we'll skip inserting it unless it's a yes/no/maybe status update.
			// This addresses the user's request: "if there is a point before which we have never set a positive yes or no then just set it as nothing"
			if (statusCode === null) continue;

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

				attendanceInserts.push({
					meetingId,
					userId: slackUserId,
					// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
					status: status as any,
				});
				attendanceInserted++;
			}
		}

		if (attendanceInserts.length > 0) {
			for (const att of attendanceInserts) {
				await db
					.insert(attendance)
					.values(att)
					.onConflictDoUpdate({
						target: [attendance.meetingId, attendance.userId],
						set: { status: att.status },
					})
					.run();
			}
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

		await db
			.insert(kvStore)
			.values({
				key: "teamsnap_last_sync_stats",
				value: JSON.stringify(stats),
			})
			.onConflictDoUpdate({
				target: kvStore.key,
				set: { value: JSON.stringify(stats) },
			})
			.run();

		// Save manual mappings
		if (Object.keys(manualMappings).length > 0) {
			const existingMappingsRow = await db
				.select({ value: kvStore.value })
				.from(kvStore)
				.where(eq(kvStore.key, "teamsnap_mappings"))
				.get();
			const existingMappingsStr = existingMappingsRow?.value as string;

			const existingMappings = existingMappingsStr
				? JSON.parse(existingMappingsStr)
				: {};
			const mergedMappings = { ...existingMappings, ...manualMappings };

			await db
				.insert(kvStore)
				.values({
					key: "teamsnap_mappings",
					value: JSON.stringify(mergedMappings),
				})
				.onConflictDoUpdate({
					target: kvStore.key,
					set: { value: JSON.stringify(mergedMappings) },
				})
				.run();
		}

		return c.json({
			success: true,
			message: "Imported past events",
			stats,
			unmatchedMembers,
			matchedMembers,
			slackUsers: slackUsers
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
