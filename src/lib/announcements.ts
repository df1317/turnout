import { and, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SlackAPIClient } from "slack-web-api-client";
import {
	attendance,
	kvStore,
	meeting,
	pendingAnnouncement,
} from "../db/schema";
import type { Env } from "../index";

/** Default number of days in advance that meetings get announced. */
const DEFAULT_ANNOUNCEMENT_WINDOW_DAYS = 14;

/**
 * Read the announcement window (how far ahead a meeting is announced) from
 * settings, in seconds. Falls back to 14 days when unset or invalid.
 */
export async function getAnnouncementWindowSeconds(
	d1: D1Database,
): Promise<number> {
	const db = drizzle(d1);
	const row = await db
		.select({ value: kvStore.value })
		.from(kvStore)
		.where(eq(kvStore.key, "announcement_window_days"))
		.get();
	const days = row?.value ? Number.parseInt(row.value, 10) : Number.NaN;
	const effective =
		Number.isFinite(days) && days > 0 ? days : DEFAULT_ANNOUNCEMENT_WINDOW_DAYS;
	return effective * 24 * 60 * 60;
}

export function buildAnnouncementBlocks(
	m: {
		id: number;
		name: string;
		description: string;
		scheduled_at: number;
		end_time?: number | null;
	},
	attendees: { yes: string[]; maybe: string[]; no: string[] },
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
): any[] {
	const mentionList = (ids: string[]) => ids.map((id) => `<@${id}>`).join(", ");
	const contextParts: string[] = [];
	if (attendees.yes.length)
		contextParts.push(`✅ Going: ${mentionList(attendees.yes)}`);
	if (attendees.maybe.length)
		contextParts.push(`🤔 Maybe: ${mentionList(attendees.maybe)}`);
	if (attendees.no.length)
		contextParts.push(`❌ Can't make it: ${mentionList(attendees.no)}`);
	if (!contextParts.length) contextParts.push("No RSVPs yet");

	let timeStr = `<!date^${m.scheduled_at}^{date_long_pretty} at {time}|${new Date(m.scheduled_at * 1000).toISOString()}>`;
	if (m.end_time) {
		timeStr += ` - <!date^${m.end_time}^{time}|${new Date(m.end_time * 1000).toISOString()}>`;
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*${m.name}*${m.description ? `\n${m.description}` : ""}\n\n📅 ${timeStr}`,
			},
		},
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: contextParts.join("\n") }],
		},
		{ type: "divider" },
		{
			type: "actions",
			elements: [
				{
					type: "button",
					text: { type: "plain_text", text: "yes" },
					action_id: "rsvp_yes",
					value: String(m.id),
					style: "primary",
				},
				{
					type: "button",
					text: { type: "plain_text", text: "maybe" },
					action_id: "rsvp_maybe",
					value: String(m.id),
				},
				{
					type: "button",
					text: { type: "plain_text", text: "no" },
					action_id: "rsvp_no",
					value: String(m.id),
					style: "danger",
				},
			],
		},
	];
}

export function buildCancelledAnnouncementBlocks(m: {
	name: string;
	description: string;
	scheduled_at: number;
	end_time?: number | null;
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
}): any[] {
	let timeStr = `<!date^${m.scheduled_at}^{date_long_pretty} at {time}|${new Date(m.scheduled_at * 1000).toISOString()}>`;
	if (m.end_time) {
		timeStr += ` - <!date^${m.end_time}^{time}|${new Date(m.end_time * 1000).toISOString()}>`;
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `~*${m.name}*~${m.description ? `\n~${m.description}~` : ""}\n\n~📅 ${timeStr}~`,
			},
		},
		{
			type: "context",
			elements: [
				{ type: "mrkdwn", text: "🚫 This meeting has been cancelled." },
			],
		},
	];
}

export async function updateAnnouncement(
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	client: any,
	d1: D1Database,
	m: {
		id: number;
		name: string;
		description: string;
		scheduled_at: number;
		end_time?: number | null;
		channel_id: string;
		message_ts: string;
		cancelled: number;
	},
): Promise<void> {
	// A real Slack ts looks like "1614987900.001200". Imported meetings carry
	// placeholders such as "none", which chat.update rejects outright.
	if (!/^\d+\.\d+$/.test(m.message_ts)) return;
	if (m.cancelled) {
		await client.chat.update({
			channel: m.channel_id,
			ts: m.message_ts,
			text: `[Cancelled] ${m.name}`,
			blocks: buildCancelledAnnouncementBlocks(m),
		});
		return;
	}
	const db = drizzle(d1);
	const attendanceRows = await db
		.select({ user_id: attendance.userId, status: attendance.status })
		.from(attendance)
		.where(eq(attendance.meetingId, m.id));
	const attendees = {
		yes: [] as string[],
		maybe: [] as string[],
		no: [] as string[],
	};
	for (const row of attendanceRows) {
		attendees[row.status as "yes" | "maybe" | "no"].push(row.user_id);
	}
	await client.chat.update({
		channel: m.channel_id,
		ts: m.message_ts,
		text: `Meeting: ${m.name}`,
		blocks: buildAnnouncementBlocks(m, attendees),
	});
}

export async function checkPendingMeetings(env: Env) {
	const now = Math.floor(Date.now() / 1000);
	const windowSeconds = await getAnnouncementWindowSeconds(env.DB);
	const threshold = now + windowSeconds;

	const db = drizzle(env.DB);
	const pending = await db
		.select({
			id: meeting.id,
			name: meeting.name,
			description: meeting.description,
			scheduled_at: meeting.scheduledAt,
			channel_id: meeting.channelId,
		})
		.from(meeting)
		.where(
			and(
				ne(meeting.channelId, ""),
				eq(meeting.messageTs, ""),
				eq(meeting.cancelled, 0),
				gt(meeting.scheduledAt, now),
				lte(meeting.scheduledAt, threshold),
			),
		);

	if (!pending.length) return;

	const botClient = new SlackAPIClient(env.SLACK_BOT_TOKEN);

	for (const m of pending) {
		try {
			await botClient.conversations
				.join({ channel: m.channel_id })
				.catch(() => {});

			const blocks = buildAnnouncementBlocks(m, {
				yes: [],
				maybe: [],
				no: [],
			});
			const posted = (await botClient.chat.postMessage({
				channel: m.channel_id,
				text: `Meeting: ${m.name}`,
				blocks,
			})) as { ts?: string };

			if (posted.ts) {
				await db
					.update(meeting)
					.set({ messageTs: posted.ts })
					.where(eq(meeting.id, m.id));
			}
		} catch (err) {
			console.error(`Failed to announce pending meeting ${m.id}:`, err);
		}
	}
}

export async function flushPendingAnnouncements(env: Env) {
	const db = drizzle(env.DB);
	const pending = await db
		.select({
			id: meeting.id,
			name: meeting.name,
			description: meeting.description,
			scheduled_at: meeting.scheduledAt,
			end_time: meeting.endTime,
			channel_id: meeting.channelId,
			message_ts: meeting.messageTs,
			cancelled: meeting.cancelled,
		})
		.from(pendingAnnouncement)
		.innerJoin(meeting, eq(meeting.id, pendingAnnouncement.meetingId))
		.orderBy(pendingAnnouncement.queuedAt)
		.limit(50);

	if (!pending.length) return;

	const botClient = new SlackAPIClient(env.SLACK_BOT_TOKEN);
	const processedIds: number[] = [];

	for (const m of pending) {
		try {
			if (m.message_ts) {
				await updateAnnouncement(botClient, env.DB, m);
			}
			processedIds.push(m.id);
		} catch (err) {
			console.error(`Failed to update announcement for meeting ${m.id}:`, err);
			processedIds.push(m.id);
		}
	}

	if (processedIds.length > 0) {
		await db
			.delete(pendingAnnouncement)
			.where(inArray(pendingAnnouncement.meetingId, processedIds));
	}
}
