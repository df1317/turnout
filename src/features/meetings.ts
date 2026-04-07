import { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import type { Env } from "../index";
import { isAdmin } from "../lib/admin";
import { generateDates } from "../lib/recurrence";
import {
	buildAnnouncementBlocks,
	buildCancelledAnnouncementBlocks,
	updateAnnouncement as _updateAnnouncement,
} from "../lib/announcements";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function postWithJoin(
	client: any,
	channelId: string,
	message: any,
): Promise<any> {
	return client.chat.postMessage(message).catch(async (err: any) => {
		if (err?.error !== "not_in_channel") throw err;
		await client.conversations.join({ channel: channelId });
		return client.chat.postMessage(message);
	});
}

function flattenState(
	stateValues: Record<string, Record<string, any>>,
): Record<string, any> {
	const flat: Record<string, any> = {};
	for (const blockState of Object.values(stateValues)) {
		for (const [actionId, val] of Object.entries(blockState)) {
			flat[actionId] = val;
		}
	}
	return flat;
}

function buildListModal(
	upcoming: { id: number; name: string; scheduled_at: number }[],
	cancelled: { id: number; name: string; scheduled_at: number }[],
	adminUser: boolean,
): any {
	const blocks: any[] = [];

	const addRow = (
		m: { id: number; name: string; scheduled_at: number },
		isCancelled: boolean,
	) => {
		const block: any = {
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
			upcoming.forEach((m) => addRow(m, false));
		}
		if (cancelled.length > 0) {
			blocks.push({
				type: "header",
				text: { type: "plain_text", text: "Cancelled" },
			});
			cancelled.forEach((m) => addRow(m, true));
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

function buildCreateModal(isRecurring: boolean): any {
	const baseBlocks: any[] = [
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
	const recurringCheckbox: any = {
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

function buildEditModal(meeting: {
	id: number;
	name: string;
	description: string;
	scheduled_at: number;
	end_time: number | null;
	channel_id: string;
	cancelled: number;
}): any {
	const actionButtons: any[] = meeting.cancelled
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

async function refreshListView(
	client: any,
	env: Env,
	rootViewId: string,
	isAdminUser: boolean,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const [upcomingMeetings, cancelledMeetings] = await Promise.all([
		env.DB.prepare(
			"SELECT id, name, scheduled_at FROM meeting WHERE scheduled_at > ? AND cancelled = 0 ORDER BY scheduled_at LIMIT 15",
		)
			.bind(now)
			.all<{ id: number; name: string; scheduled_at: number }>(),
		env.DB.prepare(
			"SELECT id, name, scheduled_at FROM meeting WHERE scheduled_at > ? AND cancelled = 1 ORDER BY scheduled_at LIMIT 10",
		)
			.bind(now)
			.all<{ id: number; name: string; scheduled_at: number }>(),
	]);
	await client.views.update({
		view_id: rootViewId,
		view: buildListModal(
			upcomingMeetings.results,
			cancelledMeetings.results,
			isAdminUser,
		),
	});
}

const updateAnnouncement = (
	client: any,
	env: Env,
	meeting: Parameters<typeof _updateAnnouncement>[2],
) => _updateAnnouncement(client, env.DB, meeting);

function buildRsvpModal(
	meetingId: number,
	status: "yes" | "maybe" | "no",
	meetingName: string,
): any {
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
				label: { type: "plain_text", text: "Note (optional)" },
				optional: true,
			},
		],
	};
}

const meetings = async (slackApp: SlackApp<SlackEdgeAppEnv>, env: Env) => {
	slackApp.command("/meetings", async ({ context, payload }) => {
		const now = Math.floor(Date.now() / 1000);
		const userId = context.userId;
		if (!userId) return;
		const [adminUser, upcomingMeetings, cancelledMeetings] = await Promise.all([
			isAdmin(env.DB, context.client, userId),
			env.DB.prepare(
				"SELECT id, name, scheduled_at FROM meeting WHERE scheduled_at > ? AND cancelled = 0 ORDER BY scheduled_at LIMIT 15",
			)
				.bind(now)
				.all<{ id: number; name: string; scheduled_at: number }>(),
			env.DB.prepare(
				"SELECT id, name, scheduled_at FROM meeting WHERE scheduled_at > ? AND cancelled = 1 ORDER BY scheduled_at LIMIT 10",
			)
				.bind(now)
				.all<{ id: number; name: string; scheduled_at: number }>(),
		]);

		await context.client.views.open({
			trigger_id: payload.trigger_id,
			view: buildListModal(
				upcomingMeetings.results,
				cancelledMeetings.results,
				adminUser,
			),
		});
	});

	slackApp.viewSubmission("meetings_list", async () => ({
		response_action: "push",
		view: buildCreateModal(false),
	}));

	slackApp.action("meeting_open_edit", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const meeting = await env.DB.prepare(
			"SELECT id, name, description, scheduled_at, end_time, channel_id, cancelled FROM meeting WHERE id = ?",
		)
			.bind(meetingId)
			.first<{
				id: number;
				name: string;
				description: string;
				scheduled_at: number;
				end_time: number | null;
				channel_id: string;
				cancelled: number;
			}>();

		if (!meeting) return;

		await context.client.views.push({
			trigger_id: (payload as any).trigger_id,
			view: buildEditModal(meeting),
		});
	});

	slackApp.action("repeat_toggle", async ({ context, payload }) => {
		const isRecurring =
			(payload as any).actions[0].selected_options?.length > 0;
		await context.client.views.update({
			view_id: (payload as any).view.id,
			hash: (payload as any).view.hash,
			view: buildCreateModal(isRecurring),
		});
	});

	slackApp.action("meeting_cancel", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const rootViewId = (payload as any).view.root_view_id;
		await env.DB.prepare("UPDATE meeting SET cancelled = 1 WHERE id = ?")
			.bind(meetingId)
			.run();
		const meeting = await env.DB.prepare(
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
			await Promise.all([
				context.client.views.update({
					view_id: (payload as any).view.id,
					view: buildEditModal(meeting),
				}),
				updateAnnouncement(context.client, env, meeting),
				rootViewId
					? refreshListView(context.client, env, rootViewId, true)
					: Promise.resolve(),
			]);
		}
	});

	slackApp.action("meeting_restore", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const rootViewId = (payload as any).view.root_view_id;
		await env.DB.prepare("UPDATE meeting SET cancelled = 0 WHERE id = ?")
			.bind(meetingId)
			.run();
		const meeting = await env.DB.prepare(
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
			await Promise.all([
				context.client.views.update({
					view_id: (payload as any).view.id,
					view: buildEditModal(meeting),
				}),
				updateAnnouncement(context.client, env, meeting),
				rootViewId
					? refreshListView(context.client, env, rootViewId, true)
					: Promise.resolve(),
			]);
		}
	});

	slackApp.action("meeting_delete", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const rootViewId = (payload as any).view.root_view_id;
		const meeting = await env.DB.prepare(
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
		await env.DB.prepare("DELETE FROM meeting WHERE id = ?")
			.bind(meetingId)
			.run();
		await Promise.all([
			context.client.views.update({
				view_id: (payload as any).view.id,
				view: {
					type: "modal",
					callback_id: "meeting_deleted",
					title: { type: "plain_text", text: "Meeting Deleted" },
					close: { type: "plain_text", text: "Close" },
					blocks: [
						{
							type: "section",
							text: { type: "mrkdwn", text: "The meeting has been deleted." },
						},
					],
				},
			}),
			meeting?.message_ts
				? context.client.chat
						.delete({ channel: meeting.channel_id, ts: meeting.message_ts })
						.catch(() => {})
				: Promise.resolve(),
			rootViewId
				? refreshListView(context.client, env, rootViewId, true)
				: Promise.resolve(),
		]);
	});

	slackApp.viewSubmission(
		"meetings_create",
		async () => ({ response_action: "clear" }),
		async (req) => {
			try {
				const flat = flattenState(req.payload.view.state.values);
				const name: string = flat.name?.value ?? "";
				const description: string = flat.description?.value ?? "";
				const channelId: string = flat.channel?.selected_channel ?? "";
				const isRecurring = flat.days !== undefined;
				const client = req.context.client;

				if (isRecurring) {
					const [hours, mins] = (flat.time?.selected_time ?? "00:00")
						.split(":")
						.map(Number);
					const timeOfDay = hours * 60 + mins;
					const duration_minutes = flat.duration_minutes?.value
						? Number(flat.duration_minutes.value)
						: null;
					const days: number[] = (flat.days?.selected_options ?? []).map(
						(o: any) => Number(o.value),
					);
					const endDate = new Date(flat.end_date?.selected_date ?? "");
					endDate.setUTCHours(23, 59, 59, 0);
					const endUnix = Math.floor(endDate.getTime() / 1000);
					const startUnix = Math.floor(Date.now() / 1000);

					const series = await env.DB.prepare(
						"INSERT INTO meeting_series (name, description, days_of_week, time_of_day, end_date) VALUES (?, ?, ?, ?, ?) RETURNING id",
					)
						.bind(name, description, JSON.stringify(days), timeOfDay, endUnix)
						.first<{ id: number }>();

					if (!series) return;

					for (const scheduled_at of generateDates(
						days,
						timeOfDay,
						startUnix,
						endUnix,
					)) {
						const end_time = duration_minutes
							? scheduled_at + duration_minutes * 60
							: null;
						const row = await env.DB.prepare(
							"INSERT INTO meeting (series_id, name, description, scheduled_at, end_time, channel_id, message_ts) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
						)
							.bind(
								series.id,
								name,
								description,
								scheduled_at,
								end_time,
								channelId,
								"",
							)
							.first<{ id: number }>();
						if (!row) continue;
						const post = await postWithJoin(client, channelId, {
							channel: channelId,
							text: `New meeting: ${name}`,
							blocks: buildAnnouncementBlocks(
								{ id: row.id, name, description, scheduled_at, end_time },
								{ yes: [], maybe: [], no: [] },
							),
						});
						await env.DB.prepare(
							"UPDATE meeting SET channel_id = ?, message_ts = ? WHERE id = ?",
						)
							.bind((post as any).channel, (post as any).ts, row.id)
							.run();
					}
				} else {
					const scheduled_at: number = flat.datetime?.selected_date_time ?? 0;
					const duration_minutes = flat.duration_minutes?.value
						? Number(flat.duration_minutes.value)
						: null;
					const end_time = duration_minutes
						? scheduled_at + duration_minutes * 60
						: null;
					const row = await env.DB.prepare(
						"INSERT INTO meeting (name, description, scheduled_at, end_time, channel_id, message_ts) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
					)
						.bind(name, description, scheduled_at, end_time, channelId, "")
						.first<{ id: number }>();
					if (!row) return;
					const post = await postWithJoin(client, channelId, {
						channel: channelId,
						text: `New meeting: ${name}`,
						blocks: buildAnnouncementBlocks(
							{ id: row.id, name, description, scheduled_at, end_time },
							{ yes: [], maybe: [], no: [] },
						),
					});
					await env.DB.prepare(
						"UPDATE meeting SET channel_id = ?, message_ts = ? WHERE id = ?",
					)
						.bind((post as any).channel, (post as any).ts, row.id)
						.run();
				}
			} catch (err) {
				console.error("meetings_create error:", err);
			}
		},
	);

	slackApp.viewSubmission(
		"meetings_edit",
		async () => ({ response_action: "clear" }),
		async (req) => {
			try {
				const { meetingId } = JSON.parse(
					req.payload.view.private_metadata ?? "{}",
				);
				const flat = flattenState(req.payload.view.state.values);
				const name: string = flat.name?.value ?? "";
				const description: string = flat.description?.value ?? "";
				const scheduled_at: number = flat.datetime?.selected_date_time ?? 0;
				const duration_minutes = flat.duration_minutes?.value
					? Number(flat.duration_minutes.value)
					: null;
				const end_time = duration_minutes
					? scheduled_at + duration_minutes * 60
					: null;
				const channelId: string = flat.channel?.selected_channel ?? "";

				await env.DB.prepare(
					"UPDATE meeting SET name = ?, description = ?, scheduled_at = ?, end_time = ?, channel_id = ? WHERE id = ?",
				)
					.bind(name, description, scheduled_at, end_time, channelId, meetingId)
					.run();

				const meeting = await env.DB.prepare(
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

				if (meeting) await updateAnnouncement(req.context.client, env, meeting);
			} catch (err) {
				console.error("meetings_edit error:", err);
			}
		},
	);

	for (const status of ["yes", "maybe", "no"] as const) {
		slackApp.action(`rsvp_${status}`, async ({ context, payload }) => {
			const value = (payload as any).actions?.[0]?.value;
			if (!value) return;
			const meetingId = Number(value);
			const meeting = await env.DB.prepare(
				"SELECT name FROM meeting WHERE id = ?",
			)
				.bind(meetingId)
				.first<{ name: string }>();
			await context.client.views.open({
				trigger_id: (payload as any).trigger_id,
				view: buildRsvpModal(
					meetingId,
					status,
					meeting?.name ?? "this meeting",
				),
			});
		});
	}

	slackApp.viewSubmission(
		"rsvp_modal",
		async () => ({ response_action: "clear" }),
		async (req) => {
			try {
				const { meetingId, status } = JSON.parse(
					req.payload.view.private_metadata ?? "{}",
				);
				const flat = flattenState(req.payload.view.state.values);
				const note: string = flat.note?.value ?? "";
				const userId = req.payload.user.id;

				await env.DB.prepare(`
          INSERT INTO attendance (meeting_id, user_id, status, note)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = excluded.status, note = excluded.note
        `)
					.bind(meetingId, userId, status, note)
					.run();

				const [attendanceRows, meeting] = await Promise.all([
					env.DB.prepare(
						"SELECT user_id, status FROM attendance WHERE meeting_id = ?",
					)
						.bind(meetingId)
						.all<{ user_id: string; status: string }>(),
					env.DB.prepare(
						"SELECT id, name, description, scheduled_at, end_time, channel_id, message_ts FROM meeting WHERE id = ?",
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
						}>(),
				]);

				const attendees = {
					yes: [] as string[],
					maybe: [] as string[],
					no: [] as string[],
				};
				for (const row of attendanceRows.results) {
					attendees[row.status as "yes" | "maybe" | "no"].push(row.user_id);
				}

				if (meeting) {
					await req.context.client.chat.update({
						channel: meeting.channel_id,
						ts: meeting.message_ts,
						text: `Meeting: ${meeting.name}`,
						blocks: buildAnnouncementBlocks(meeting, attendees),
					});
				}
			} catch (err) {
				console.error("rsvp_modal error:", err);
			}
		},
	);
};

export default meetings;
