import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
	attendance,
	kvStore,
	meeting,
	slackCache,
	slackUser,
} from "../../db/schema";
import type { Env } from "../../index";
import { TeamSnapClient } from "../../lib/teamsnap/client";
import { extractData } from "../../lib/teamsnap/types";
import { requireAdmin } from "../middleware/session";

const teamsnap = new Hono<{ Bindings: Env }>();

teamsnap.get("/sync", requireAdmin(), async (c) => {
	const db = drizzle(c.env.DB);

	const configRows = await db
		.select({ key: kvStore.key, value: kvStore.value })
		.from(kvStore)
		.where(inArray(kvStore.key, ["teamsnap_token", "teamsnap_team_id"]))
		.all();
	const token = configRows.find((r) => r.key === "teamsnap_token")
		?.value as string;
	const teamIdStr = configRows.find((r) => r.key === "teamsnap_team_id")
		?.value as string;

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
	const bustCache = c.req.query("bust") === "true";

	// Parse manual mappings passed from UI
	const manualMappingsStr = c.req.query("mappings");
	const manualMappings: Record<string, string> = manualMappingsStr
		? JSON.parse(manualMappingsStr)
		: {};

	const CACHE_TTL = 10 * 60; // 10 minutes — enough time to review and re-submit

	async function getCachedOrFetch<T>(
		key: string,
		fetcher: () => Promise<T>,
	): Promise<T> {
		const now = Math.floor(Date.now() / 1000);
		if (!bustCache) {
			const cached = await db
				.select({ value: slackCache.value, expiresAt: slackCache.expiresAt })
				.from(slackCache)
				.where(eq(slackCache.key, key))
				.get();
			if (cached && cached.expiresAt > now) return JSON.parse(cached.value);
		}

		const fresh = await fetcher();
		await db
			.insert(slackCache)
			.values({ key, value: JSON.stringify(fresh), expiresAt: now + CACHE_TTL })
			.onConflictDoUpdate({
				target: slackCache.key,
				set: { value: JSON.stringify(fresh), expiresAt: now + CACHE_TTL },
			})
			.run();
		return fresh;
	}

	try {
		// 1. Parallel I/O: API calls (with caching) + DB reads are all independent
		const [
			{ collection },
			{ collection: availCollection },
			slackUsers,
			savedMappingsRow,
		] = await Promise.all([
			getCachedOrFetch(`teamsnap_bulk_${teamIdStr}`, () =>
				client.getBulkLoad(),
			),
			getCachedOrFetch(`teamsnap_avail_${teamIdStr}`, () =>
				client.getAvailabilities(),
			),
			db
				.select({
					user_id: slackUser.userId,
					name: slackUser.name,
					role: slackUser.role,
				})
				.from(slackUser)
				.all(),
			db
				.select({ value: kvStore.value })
				.from(kvStore)
				.where(eq(kvStore.key, "teamsnap_mappings"))
				.get(),
		]);

		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		const events: Record<string, any>[] = [];
		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		const members: Record<string, any>[] = [];
		for (const item of collection.items) {
			if (item.href.includes("/events/")) {
				const data = extractData(item);
				const startDateStr = data.start_date as string;
				if (!startDateStr) continue;
				if (new Date(startDateStr).getTime() > cutoffMs) events.push(data);
			} else if (item.href.includes("/members/")) {
				members.push(extractData(item));
			}
		}

		if (events.length === 0)
			return c.json({ message: "No events in timeframe" });

		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		const availabilities: Record<string, any>[] = [];
		for (const item of availCollection.items) {
			if (item.href.includes("/availabilities/"))
				availabilities.push(extractData(item));
		}

		const savedMappingsStr = savedMappingsRow?.value as string;
		const effectiveMappings = {
			...(savedMappingsStr ? JSON.parse(savedMappingsStr) : {}),
			...manualMappings,
		};

		// 2. Match Members to our Slack DB

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

		// 3. Upsert meetings, get IDs back via RETURNING (avoids a separate SELECT)
		const meetingInserts = events.map((event) => ({
			name: (event.name || "Team Meeting") as string,
			scheduledAt: Math.floor(
				new Date(event.start_date as string).getTime() / 1000,
			),
			channelId: "teamsnap-import",
			messageTs: "none",
		}));

		const meetingStmts = meetingInserts.map((row) =>
			db
				.insert(meeting)
				.values(row)
				.onConflictDoUpdate({
					target: [meeting.channelId, meeting.scheduledAt],
					set: { name: row.name },
				})
				.returning({
					id: meeting.id,
					name: meeting.name,
					scheduledAt: meeting.scheduledAt,
				}),
		);
		const meetingRows: { id: number; name: string; scheduledAt: number }[] = [];
		for (let i = 0; i < meetingStmts.length; i += 100) {
			const results = await db.batch(
				meetingStmts.slice(i, i + 100) as [(typeof meetingStmts)[0]],
			);
			for (const result of results) meetingRows.push(...result);
		}
		const meetingMap = new Map(
			meetingRows.map((r) => [`${r.name}-${r.scheduledAt}`, r.id]),
		);

		// 4. Build attendance — O(1) event lookup via Map instead of O(N) find per availability
		// biome-ignore lint/suspicious/noExplicitAny: Data is untyped JSON from TS API
		const eventsById = new Map(events.map((e) => [e.id as any, e]));
		let attendanceInserted = 0;
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const attendanceInsertsMap = new Map<string, any>();
		for (const avail of availabilities) {
			const {
				event_id: tsEventId,
				member_id: tsMemberId,
				status_code: statusCode,
			} = avail;
			if (statusCode === null) continue;

			const tsEvent = eventsById.get(tsEventId);
			if (!tsEvent) continue;

			const scheduledAt = Math.floor(
				new Date(tsEvent.start_date as string).getTime() / 1000,
			);
			const meetingId = meetingMap.get(
				`${tsEvent.name || "Team Meeting"}-${scheduledAt}`,
			);
			const slackUserId = tsToSlackUserMap.get(tsMemberId);

			if (meetingId && slackUserId) {
				let status = "maybe";
				if (statusCode === 1) status = "yes";
				if (statusCode === 0) status = "no";
				attendanceInsertsMap.set(`${meetingId}-${slackUserId}`, {
					meetingId,
					userId: slackUserId,
					status: status as "yes" | "no" | "maybe",
				});
			}
		}

		const attendanceInserts = Array.from(attendanceInsertsMap.values());
		attendanceInserted = attendanceInserts.length;

		if (attendanceInserts.length > 0) {
			const attendanceStmts = attendanceInserts.map((att) =>
				db
					.insert(attendance)
					.values(att)
					.onConflictDoUpdate({
						target: [attendance.meetingId, attendance.userId],
						set: { status: att.status },
					}),
			);
			for (let i = 0; i < attendanceStmts.length; i += 100) {
				await db.batch(
					attendanceStmts.slice(i, i + 100) as [(typeof attendanceStmts)[0]],
				);
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
