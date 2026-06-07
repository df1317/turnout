/**
 * Pure Slack Block Kit modal builders for meetings.
 * These are UI templates with no side effects — separated from the async
 * Slack event handlers in features/meetings.ts.
 */

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
		};
		if (adminUser) {
			block.accessory = {
				type: "button",
				text: { type: "plain_text", text: "Edit" },
				action_id: "meeting_open_edit",
				value: String(m.id),
			};
		}
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

export function buildCreateModal(isRecurring: boolean): Modal {
	const baseBlocks: Block[] = [
		{
			type: "input",
			block_id: "name_block",
			element: { type: "plain_text_input", action_id: "name" },
			label: { type: "plain_text", text: "Meeting name" },
		},
		{
			type: "input",
			block_id: "description_block",
			element: {
				type: "plain_text_input",
				action_id: "description",
				multiline: true,
			},
			label: { type: "plain_text", text: "Description" },
			optional: true,
		},
		{
			type: "input",
			block_id: "channel_block",
			element: { type: "channels_select", action_id: "channel" },
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

export function buildEditModal(meeting: {
	id: number;
	name: string;
	description: string;
	scheduled_at: number;
	end_time: number | null;
	channel_id: string;
	cancelled: number;
}): Modal {
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
		text: { type: "plain_text", text: "Delete" },
		action_id: "meeting_delete",
		value: String(meeting.id),
		style: "danger",
		confirm: {
			title: { type: "plain_text", text: "Delete Meeting?" },
			text: {
				type: "mrkdwn",
				text: `This will permanently delete *${meeting.name}* and all RSVPs.`,
			},
			confirm: { type: "plain_text", text: "Delete" },
			deny: { type: "plain_text", text: "Keep" },
			style: "danger",
		},
	});

	return {
		type: "modal",
		callback_id: "meetings_edit",
		private_metadata: JSON.stringify({ meetingId: meeting.id }),
		title: { type: "plain_text", text: "Edit Meeting" },
		submit: { type: "plain_text", text: "Save" },
		close: { type: "plain_text", text: "Back" },
		blocks: [
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
					type: "channels_select",
					action_id: "channel",
					initial_channel: meeting.channel_id,
				},
				label: { type: "plain_text", text: "Channel" },
			},
			{ type: "divider" },
			{ type: "actions", elements: actionButtons },
		],
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
