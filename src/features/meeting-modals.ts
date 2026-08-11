/**
 * Pure Slack Block Kit modal builders for meetings.
 * These are UI templates with no side effects — separated from the async
 * Slack event handlers in features/meetings.ts.
 */

import { isPosted, TEAMSNAP_CHANNEL, UNPOSTED_TS } from "../lib/announcements";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit shapes are untyped
type Block = any;
// biome-ignore lint/suspicious/noExplicitAny: Slack modal shapes are untyped
type Modal = any;

export function buildListModal(
	upcoming: { id: number; name: string; scheduled_at: number }[],
	cancelled: { id: number; name: string; scheduled_at: number }[],
	adminUser: boolean,
): Modal {
	const blocks: Block[] = [];

	const addRow = (
		m: { id: number; name: string; scheduled_at: number },
		isCancelled: boolean,
	) => {
		const block: Block = {
			type: "section",
			text: {
				type: "mrkdwn",
				text: `${isCancelled ? "~" : ""}*${m.name}*${isCancelled ? "~" : ""}\n<!date^${m.scheduled_at}^{date_long_pretty} at {time}|${new Date(m.scheduled_at * 1000).toISOString()}>`,
			},
			accessory: {
				type: "button",
				text: { type: "plain_text", text: adminUser ? "Edit" : "RSVP" },
				action_id: "meeting_open_edit",
				value: String(m.id),
			},
		};
		blocks.push(block);
	};

	if (upcoming.length === 0 && cancelled.length === 0) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: "_No upcoming meetings._" },
		});
	} else {
		if (upcoming.length > 0) {
			blocks.push({
				type: "header",
				text: { type: "plain_text", text: "Upcoming" },
			});
			for (const m of upcoming) addRow(m, false);
		}
		if (cancelled.length > 0) {
			blocks.push({
				type: "header",
				text: { type: "plain_text", text: "Cancelled" },
			});
			for (const m of cancelled) addRow(m, true);
		}
	}

	return {
		type: "modal",
		callback_id: "meetings_list",
		title: { type: "plain_text", text: "Meetings" },
		close: { type: "plain_text", text: "Close" },
		...(adminUser
			? { submit: { type: "plain_text", text: "Create Meeting" } }
			: {}),
		blocks,
	};
}

export function buildCreateModal(
	isRecurring: boolean,
	// Carried over when the recurring toggle rebuilds the view, so typing
	// isn't lost.
	initial: { name?: string; description?: string; channelId?: string } = {},
): Modal {
	const baseBlocks: Block[] = [
		{
			type: "input",
			block_id: "name_block",
			element: {
				type: "plain_text_input",
				action_id: "name",
				...(initial.name ? { initial_value: initial.name } : {}),
			},
			label: { type: "plain_text", text: "Meeting name" },
		},
		{
			type: "input",
			block_id: "description_block",
			element: {
				type: "plain_text_input",
				action_id: "description",
				multiline: true,
				...(initial.description ? { initial_value: initial.description } : {}),
			},
			label: { type: "plain_text", text: "Description" },
			optional: true,
		},
		{
			type: "input",
			block_id: "channel_block",
			element: {
				type: "conversations_select",
				action_id: "channel",
				filter: { include: ["public", "private"] },
				...(initial.channelId
					? { initial_conversation: initial.channelId }
					: {}),
			},
			label: { type: "plain_text", text: "Post to channel" },
		},
	];

	const recurringOption = {
		text: { type: "plain_text", text: "Recurring meeting" },
		value: "recurring",
	};
	const recurringCheckbox: Block = {
		type: "checkboxes",
		action_id: "repeat_toggle",
		options: [recurringOption],
	};
	if (isRecurring) recurringCheckbox.initial_options = [recurringOption];

	const extraBlocks = isRecurring
		? [
				{
					type: "actions",
					block_id: "recurring_block",
					elements: [recurringCheckbox],
				},
				{
					type: "input",
					block_id: "days_block",
					element: {
						type: "checkboxes",
						action_id: "days",
						options: DAYS_OF_WEEK.map((day, i) => ({
							text: { type: "plain_text", text: day },
							value: String(i),
						})),
					},
					label: { type: "plain_text", text: "Repeat on" },
				},
				{
					type: "input",
					block_id: "time_block",
					element: { type: "timepicker", action_id: "time" },
					label: { type: "plain_text", text: "Time of day" },
				},
				{
					type: "input",
					block_id: "duration_block",
					element: {
						type: "plain_text_input",
						action_id: "duration_minutes",
						placeholder: { type: "plain_text", text: "e.g. 60 or 120" },
					},
					label: { type: "plain_text", text: "Duration (minutes)" },
					optional: true,
				},
				{
					type: "input",
					block_id: "start_date_block",
					element: {
						type: "datepicker",
						action_id: "start_date",
						initial_date: new Date().toISOString().slice(0, 10),
					},
					label: { type: "plain_text", text: "Start date" },
				},
				{
					type: "input",
					block_id: "end_date_block",
					element: { type: "datepicker", action_id: "end_date" },
					label: { type: "plain_text", text: "Repeat until" },
				},
			]
		: [
				{
					type: "input",
					block_id: "datetime_block",
					element: { type: "datetimepicker", action_id: "datetime" },
					label: { type: "plain_text", text: "Date & Time" },
				},
				{
					type: "input",
					block_id: "duration_block",
					element: {
						type: "plain_text_input",
						action_id: "duration_minutes",
						placeholder: { type: "plain_text", text: "e.g. 60 or 120" },
					},
					label: { type: "plain_text", text: "Duration (minutes)" },
					optional: true,
				},
				{
					type: "actions",
					block_id: "recurring_block",
					elements: [recurringCheckbox],
				},
			];

	return {
		type: "modal",
		callback_id: "meetings_create",
		title: { type: "plain_text", text: "Create Meeting" },
		submit: { type: "plain_text", text: "Create" },
		close: { type: "plain_text", text: "Back" },
		blocks: [...baseBlocks, ...extraBlocks],
	};
}

/**
 * Describe whether/when a meeting's announcement will be posted, for the
 * admin subtitle in the edit modal, and gate the three announcement controls:
 * "Post Now", its companion "Delete Now", and "Turn On Auto-Post".
 */
function buildPostingStatus(
	meeting: {
		scheduled_at: number;
		channel_id: string;
		message_ts?: string | null;
		cancelled: number;
	},
	announcementWindowSeconds?: number,
): {
	text: string;
	canPostNow: boolean;
	canUnpost: boolean;
	canEnableAutoPost?: boolean;
} {
	const live = isPosted(meeting.message_ts);
	if (meeting.cancelled) {
		return {
			text: live
				? `This meeting is cancelled. Its announcement in <#${meeting.channel_id}> is struck through.`
				: "This meeting is cancelled and won't be posted.",
			canPostNow: false,
			canUnpost: live,
		};
	}
	const now = Math.floor(Date.now() / 1000);

	// When the sweep would announce this meeting, phrased for reuse in both the
	// scheduled and the taken-down wording.
	const postAt =
		announcementWindowSeconds != null
			? meeting.scheduled_at - announcementWindowSeconds
			: now;
	const due = postAt <= now;
	const when = due
		? "within the minute"
		: `on <!date^${postAt}^{date_long_pretty} at {time}|${new Date(postAt * 1000).toISOString()}>`;

	if (!meeting.channel_id || meeting.channel_id === TEAMSNAP_CHANNEL) {
		return {
			text: `Pick a channel below to announce it — it would post ${when}.`,
			canPostNow: false,
			canUnpost: false,
		};
	}
	if (live) {
		return {
			text: `Posted in <#${meeting.channel_id}>. *Delete Now* removes that message; the meeting itself stays.`,
			canPostNow: false,
			canUnpost: true,
		};
	}
	if (meeting.message_ts === UNPOSTED_TS) {
		return {
			text: `Would post in <#${meeting.channel_id}> ${when}, but auto-posting is off — use *Turn On Auto-Post* to let it, or *Post Now* to announce it immediately.`,
			canPostNow: true,
			canUnpost: false,
			canEnableAutoPost: true,
		};
	}
	return {
		text: due
			? `Due to post in <#${meeting.channel_id}> ${when}. Use *Post Now* to announce it immediately.`
			: `Will auto-post in <#${meeting.channel_id}> ${when}. Use *Post Now* to announce it early.`,
		canPostNow: true,
		canUnpost: false,
	};
}

export function buildEditModal(
	meeting: {
		id: number;
		name: string;
		description: string;
		scheduled_at: number;
		end_time: number | null;
		channel_id: string;
		message_ts?: string | null;
		cancelled: number;
	},
	isAdmin: boolean,
	currentRsvp?: { status: string; note: string },
	announcementWindowSeconds?: number,
): Modal {
	const posting = buildPostingStatus(meeting, announcementWindowSeconds);

	// Buttons that act on the Slack announcement, kept in their own row so
	// "Delete Now" is never mistaken for "Delete Meeting" below it.
	const announcementButtons: Block[] = [];
	if (posting.canPostNow) {
		announcementButtons.push({
			type: "button",
			text: { type: "plain_text", text: "Post Now" },
			action_id: "meeting_post_now",
			value: String(meeting.id),
			style: "primary",
		});
	}
	if (posting.canUnpost) {
		announcementButtons.push({
			type: "button",
			text: { type: "plain_text", text: "Delete Now" },
			action_id: "meeting_unpost",
			value: String(meeting.id),
			style: "danger",
			confirm: {
				title: { type: "plain_text", text: "Delete Announcement?" },
				text: {
					type: "mrkdwn",
					text: `This removes the Slack message for *${meeting.name}* and stops it auto-posting. The meeting and its RSVPs stay put.`,
				},
				confirm: { type: "plain_text", text: "Delete Announcement" },
				deny: { type: "plain_text", text: "Keep" },
				style: "danger",
			},
		});
	}
	if (posting.canEnableAutoPost) {
		announcementButtons.push({
			type: "button",
			text: { type: "plain_text", text: "Turn On Auto-Post" },
			action_id: "meeting_enable_autopost",
			value: String(meeting.id),
		});
	}

	const actionButtons: Block[] = meeting.cancelled
		? [
				{
					type: "button",
					text: { type: "plain_text", text: "Restore Meeting" },
					action_id: "meeting_restore",
					value: String(meeting.id),
					style: "primary",
				},
			]
		: [
				{
					type: "button",
					text: { type: "plain_text", text: "Cancel Meeting" },
					action_id: "meeting_cancel",
					value: String(meeting.id),
					style: "danger",
					confirm: {
						title: { type: "plain_text", text: "Cancel Meeting?" },
						text: {
							type: "mrkdwn",
							text: `This will mark *${meeting.name}* as cancelled.`,
						},
						confirm: { type: "plain_text", text: "Cancel Meeting" },
						deny: { type: "plain_text", text: "Keep" },
						style: "danger",
					},
				},
			];

	actionButtons.push({
		type: "button",
		text: { type: "plain_text", text: "Delete Meeting" },
		action_id: "meeting_delete",
		value: String(meeting.id),
		style: "danger",
		confirm: {
			title: { type: "plain_text", text: "Delete Meeting?" },
			text: {
				type: "mrkdwn",
				text: `This will permanently delete *${meeting.name}* and all RSVPs.`,
			},
			confirm: { type: "plain_text", text: "Delete Meeting" },
			deny: { type: "plain_text", text: "Keep" },
			style: "danger",
		},
	});

	const rsvpButtons: Block[] = (["yes", "maybe", "no"] as const).map(
		(status) => ({
			type: "button",
			text: {
				type: "plain_text",
				text:
					status === "yes"
						? "✅ Yes"
						: status === "maybe"
							? "🤔 Maybe"
							: "❌ No",
			},
			action_id: `edit_rsvp_${status}`,
			value: String(meeting.id),
			...(currentRsvp?.status === status ? { style: "primary" } : {}),
		}),
	);

	const blocks: Block[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*${meeting.name}*\n<!date^${meeting.scheduled_at}^{date_long_pretty} at {time}|${new Date(meeting.scheduled_at * 1000).toISOString()}>`,
			},
		},
		{ type: "actions", elements: rsvpButtons },
		{
			type: "input",
			block_id: "rsvp_note_block",
			element: {
				type: "plain_text_input",
				action_id: "rsvp_note",
				multiline: true,
				initial_value: currentRsvp?.note ?? "",
			},
			label: { type: "plain_text", text: "Note" },
			optional: true,
		},
	];

	if (isAdmin) {
		blocks.push(
			{ type: "divider" },
			{
				type: "input",
				block_id: "name_block",
				element: {
					type: "plain_text_input",
					action_id: "name",
					initial_value: meeting.name,
				},
				label: { type: "plain_text", text: "Meeting name" },
			},
			{
				type: "input",
				block_id: "description_block",
				element: {
					type: "plain_text_input",
					action_id: "description",
					multiline: true,
					initial_value: meeting.description,
				},
				label: { type: "plain_text", text: "Description" },
				optional: true,
			},
			{
				type: "input",
				block_id: "datetime_block",
				element: {
					type: "datetimepicker",
					action_id: "datetime",
					initial_date_time: meeting.scheduled_at,
				},
				label: { type: "plain_text", text: "Date & Time" },
			},
			{
				type: "input",
				block_id: "duration_block",
				element: {
					type: "plain_text_input",
					action_id: "duration_minutes",
					initial_value: meeting.end_time
						? String(Math.round((meeting.end_time - meeting.scheduled_at) / 60))
						: "",
				},
				label: { type: "plain_text", text: "Duration (minutes)" },
				optional: true,
			},
			{
				type: "input",
				block_id: "channel_block",
				element: {
					type: "conversations_select",
					action_id: "channel",
					...(meeting.channel_id
						? { initial_conversation: meeting.channel_id }
						: {}),
					filter: { include: ["public", "private"] },
				},
				label: { type: "plain_text", text: "Channel" },
			},
			{
				type: "context",
				elements: [
					{ type: "mrkdwn", text: `📣 *Announcement* — ${posting.text}` },
				],
			},
			...(announcementButtons.length
				? [{ type: "actions", elements: announcementButtons }]
				: []),
			{ type: "divider" },
			{
				type: "context",
				elements: [
					{
						type: "mrkdwn",
						text: "🗓️ *This meeting* — these change the meeting itself, not just its Slack post.",
					},
				],
			},
			{ type: "actions", elements: actionButtons },
		);
	}

	return {
		type: "modal",
		callback_id: "meetings_edit",
		private_metadata: JSON.stringify({ meetingId: meeting.id }),
		title: {
			type: "plain_text",
			text: isAdmin ? "Edit Meeting" : "RSVP",
		},
		submit: { type: "plain_text", text: isAdmin ? "Save" : "Save Note" },
		close: { type: "plain_text", text: "Back" },
		blocks,
	};
}

export function buildRsvpModal(
	meetingId: number,
	status: "yes" | "maybe" | "no",
	meetingName: string,
): Modal {
	const label =
		status === "yes" ? "✅ Yes" : status === "maybe" ? "🤔 Maybe" : "❌ No";
	return {
		type: "modal",
		callback_id: "rsvp_modal",
		private_metadata: JSON.stringify({ meetingId, status }),
		title: { type: "plain_text", text: "RSVP" },
		submit: { type: "plain_text", text: "Submit" },
		close: { type: "plain_text", text: "Cancel" },
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `Responding *${label}* to *${meetingName}*.`,
				},
			},
			{
				type: "input",
				block_id: "note_block",
				element: {
					type: "plain_text_input",
					action_id: "note",
					multiline: true,
				},
				label: { type: "plain_text", text: "Note" },
				optional: true,
			},
		],
	};
}
