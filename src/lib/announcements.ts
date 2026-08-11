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
import { postWithJoin } from "./slack-utils";

/** Default number of days in advance that meetings get announced. */
const DEFAULT_ANNOUNCEMENT_WINDOW_DAYS = 14;

/**
 * `message_ts` marking an announcement an admin deliberately took down. It is
 * deliberately not a real timestamp, so the daily sweep (which only picks up
 * `""`) leaves the meeting alone until someone posts it again by hand.
 */
export const UNPOSTED_TS = "unposted";

/** Channel placeholder the TeamSnap importer uses for attendance-only rows. */
export const TEAMSNAP_CHANNEL = "teamsnap-import";

/**
 * True when `ts` points at a live Slack message. Real timestamps look like
 * "1614987900.001200"; imported and taken-down rows carry placeholders such as
 * "none" or "unposted", which chat.update and chat.delete reject outright.
 */
export function isPosted(ts?: string | null): boolean {
	return !!ts && /^\d+\.\d+$/.test(ts);
}

/** Every RSVP for a meeting, bucketed by status. */
export async function getAttendees(
	d1: D1Database,
	meetingId: number,
): Promise<{ yes: string[]; maybe: string[]; no: string[] }> {
	const db = drizzle(d1);
	const rows = await db
		.select({ user_id: attendance.userId, status: attendance.status })
		.from(attendance)
		.where(eq(attendance.meetingId, meetingId));
	const attendees = {
		yes: [] as string[],
		maybe: [] as string[],
		no: [] as string[],
	};
	for (const row of rows) {
		attendees[row.status as "yes" | "maybe" | "no"].push(row.user_id);
	}
	return attendees;
}

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
	if (!isPosted(m.message_ts)) return;
	if (m.cancelled) {
		await client.chat.update({
			channel: m.channel_id,
			ts: m.message_ts,
			text: `[Cancelled] ${m.name}`,
			blocks: buildCancelledAnnouncementBlocks(m),
		});
		return;
	}
	const attendees = await getAttendees(d1, m.id);
	await client.chat.update({
		channel: m.channel_id,
		ts: m.message_ts,
		text: `Meeting: ${m.name}`,
		blocks: buildAnnouncementBlocks(m, attendees),
	});
}

/**
 * Announce a meeting in its channel with its current RSVPs and record where the
 * message landed. Throws if Slack rejects the post; callers decide how loud to
 * be about it.
 */
export async function postAnnouncement(
	// biome-ignore lint/suspicious/noExplicitAny: Slack client type is incomplete
	client: any,
	d1: D1Database,
	m: {
		id: number;
		name: string;
		description: string;
		scheduled_at: number;
		end_time?: number | null;
		channel_id: string;
	},
): Promise<{ channel_id: string; message_ts: string }> {
	const attendees = await getAttendees(d1, m.id);
	const posted = (await postWithJoin(client, m.channel_id, {
		channel: m.channel_id,
		text: `Meeting: ${m.name}`,
		blocks: buildAnnouncementBlocks(m, attendees),
	})) as { ts?: string; channel?: string };

	if (!posted.ts) throw new Error("Slack accepted the post but returned no ts");

	const channel_id = posted.channel ?? m.channel_id;
	await drizzle(d1)
		.update(meeting)
		.set({ channelId: channel_id, messageTs: posted.ts })
		.where(eq(meeting.id, m.id));

	return { channel_id, message_ts: posted.ts };
}

/**
 * Hand a meeting back to the daily sweep by clearing the "taken down" sentinel,
 * so it announces itself on schedule again.
 */
export async function enableAutoPost(
	d1: D1Database,
	meetingId: number,
): Promise<void> {
	await drizzle(d1)
		.update(meeting)
		.set({ messageTs: "" })
		.where(eq(meeting.id, meetingId));
}

/**
 * Take an announcement back down. The meeting itself survives; it just stops
 * being visible in Slack, and stays that way until someone posts it again.
 */
export async function unpostAnnouncement(
	// biome-ignore lint/suspicious/noExplicitAny: Slack client type is incomplete
	client: any,
	d1: D1Database,
	m: { id: number; channel_id: string; message_ts: string },
): Promise<void> {
	if (isPosted(m.message_ts)) {
		// A message that is already gone is the state we wanted anyway.
		await client.chat
			.delete({ channel: m.channel_id, ts: m.message_ts })
			.catch((err: { error?: string }) => {
				if (err?.error !== "message_not_found") throw err;
			});
	}
	await drizzle(d1)
		.update(meeting)
		.set({ messageTs: UNPOSTED_TS })
		.where(eq(meeting.id, m.id));
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
			end_time: meeting.endTime,
			channel_id: meeting.channelId,
		})
		.from(meeting)
		.where(
			and(
				ne(meeting.channelId, ""),
				ne(meeting.channelId, TEAMSNAP_CHANNEL),
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
			await postAnnouncement(botClient, env.DB, m);
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
