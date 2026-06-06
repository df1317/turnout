import { and, asc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import {
	attendance,
	meetingSeries,
	meeting as meetingTable,
} from "../db/schema";
import type { Env } from "../index";
import { isAdmin } from "../lib/admin";
import {
	updateAnnouncement as _updateAnnouncement,
	buildAnnouncementBlocks,
} from "../lib/announcements";
import { generateDates } from "../lib/recurrence";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

import { flattenState, postWithJoin } from "../lib/slack-utils";

function buildListModal(
	upcoming: { id: number; name: string; scheduled_at: number }[],
	cancelled: { id: number; name: string; scheduled_at: number }[],
	adminUser: boolean,
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
): any {
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	const blocks: any[] = [];

	const addRow = (
		m: { id: number; name: string; scheduled_at: number },
		isCancelled: boolean,
	) => {
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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

// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
function buildCreateModal(isRecurring: boolean): any {
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
}): any {
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	client: any,
	env: Env,
	rootViewId: string,
	isAdminUser: boolean,
): Promise<void> {
	const db = drizzle(env.DB);
	const now = Math.floor(Date.now() / 1000);
	const [upcomingMeetings, cancelledMeetings] = await Promise.all([
		db
			.select({
				id: meetingTable.id,
				name: meetingTable.name,
				scheduled_at: meetingTable.scheduledAt,
			})
			.from(meetingTable)
			.where(
				and(gt(meetingTable.scheduledAt, now), eq(meetingTable.cancelled, 0)),
			)
			.orderBy(asc(meetingTable.scheduledAt))
			.limit(15),
		db
			.select({
				id: meetingTable.id,
				name: meetingTable.name,
				scheduled_at: meetingTable.scheduledAt,
			})
			.from(meetingTable)
			.where(
				and(gt(meetingTable.scheduledAt, now), eq(meetingTable.cancelled, 1)),
			)
			.orderBy(asc(meetingTable.scheduledAt))
			.limit(10),
	]);
	await client.views.update({
		view_id: rootViewId,
		view: buildListModal(upcomingMeetings, cancelledMeetings, isAdminUser),
	});
}

const updateAnnouncement = (
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	client: any,
	env: Env,
	meeting: Parameters<typeof _updateAnnouncement>[2],
) => _updateAnnouncement(client, env.DB, meeting);

function buildRsvpModal(
	meetingId: number,
	status: "yes" | "maybe" | "no",
	meetingName: string,
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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
				label: { type: "plain_text", text: "Note" },
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
		const db = drizzle(env.DB);
		const [adminUser, upcomingMeetings, cancelledMeetings] = await Promise.all([
			isAdmin(env.DB, context.client, userId),
			db
				.select({
					id: meetingTable.id,
					name: meetingTable.name,
					scheduled_at: meetingTable.scheduledAt,
				})
				.from(meetingTable)
				.where(
					and(gt(meetingTable.scheduledAt, now), eq(meetingTable.cancelled, 0)),
				)
				.orderBy(asc(meetingTable.scheduledAt))
				.limit(15),
			db
				.select({
					id: meetingTable.id,
					name: meetingTable.name,
					scheduled_at: meetingTable.scheduledAt,
				})
				.from(meetingTable)
				.where(
					and(gt(meetingTable.scheduledAt, now), eq(meetingTable.cancelled, 1)),
				)
				.orderBy(asc(meetingTable.scheduledAt))
				.limit(10),
		]);

		await context.client.views.open({
			trigger_id: payload.trigger_id,
			view: buildListModal(upcomingMeetings, cancelledMeetings, adminUser),
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
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const db = drizzle(env.DB);
		const meetingRow = await db
			.select({
				id: meetingTable.id,
				name: meetingTable.name,
				description: meetingTable.description,
				scheduled_at: meetingTable.scheduledAt,
				end_time: meetingTable.endTime,
				channel_id: meetingTable.channelId,
				cancelled: meetingTable.cancelled,
			})
			.from(meetingTable)
			.where(eq(meetingTable.id, meetingId))
			.get();

		if (!meetingRow) return;

		await context.client.views.push({
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
			trigger_id: (payload as any).trigger_id,
			view: buildEditModal(meetingRow),
		});
	});

	slackApp.action("repeat_toggle", async ({ context, payload }) => {
		const isRecurring =
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
			(payload as any).actions[0].selected_options?.length > 0;
		await context.client.views.update({
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
			view_id: (payload as any).view.id,
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
			hash: (payload as any).view.hash,
			view: buildCreateModal(isRecurring),
		});
	});

	slackApp.action("meeting_cancel", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const rootViewId = (payload as any).view.root_view_id;
		const db = drizzle(env.DB);
		await db
			.update(meetingTable)
			.set({ cancelled: 1 })
			.where(eq(meetingTable.id, meetingId))
			.run();
		const meeting = await db
			.select({
				id: meetingTable.id,
				name: meetingTable.name,
				description: meetingTable.description,
				scheduled_at: meetingTable.scheduledAt,
				end_time: meetingTable.endTime,
				channel_id: meetingTable.channelId,
				message_ts: meetingTable.messageTs,
				cancelled: meetingTable.cancelled,
			})
			.from(meetingTable)
			.where(eq(meetingTable.id, meetingId))
			.get();
		if (meeting) {
			await Promise.all([
				context.client.views.update({
					// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const rootViewId = (payload as any).view.root_view_id;
		const db = drizzle(env.DB);
		await db
			.update(meetingTable)
			.set({ cancelled: 0 })
			.where(eq(meetingTable.id, meetingId))
			.run();
		const meeting = await db
			.select({
				id: meetingTable.id,
				name: meetingTable.name,
				description: meetingTable.description,
				scheduled_at: meetingTable.scheduledAt,
				end_time: meetingTable.endTime,
				channel_id: meetingTable.channelId,
				message_ts: meetingTable.messageTs,
				cancelled: meetingTable.cancelled,
			})
			.from(meetingTable)
			.where(eq(meetingTable.id, meetingId))
			.get();
		if (meeting) {
			await Promise.all([
				context.client.views.update({
					// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		const rootViewId = (payload as any).view.root_view_id;
		const db = drizzle(env.DB);
		const meeting = await db
			.select({
				id: meetingTable.id,
				name: meetingTable.name,
				description: meetingTable.description,
				scheduled_at: meetingTable.scheduledAt,
				end_time: meetingTable.endTime,
				channel_id: meetingTable.channelId,
				message_ts: meetingTable.messageTs,
				cancelled: meetingTable.cancelled,
			})
			.from(meetingTable)
			.where(eq(meetingTable.id, meetingId))
			.get();
		await db.delete(meetingTable).where(eq(meetingTable.id, meetingId)).run();
		await Promise.all([
			context.client.views.update({
				// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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
						// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
						(o: any) => Number(o.value),
					);
					const endDate = new Date(flat.end_date?.selected_date ?? "");
					endDate.setUTCHours(23, 59, 59, 0);
					const endUnix = Math.floor(endDate.getTime() / 1000);
					const startUnix = Math.floor(Date.now() / 1000);

					const db = drizzle(env.DB);
					const seriesResult = await db
						.insert(meetingSeries)
						.values({
							name,
							description,
							daysOfWeek: JSON.stringify(days),
							timeOfDay,
							endDate: endUnix,
						})
						.returning({ id: meetingSeries.id })
						.get();
					const series = seriesResult ? { id: seriesResult.id } : undefined;

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
						const rowResult = await db
							.insert(meetingTable)
							.values({
								seriesId: series.id,
								name,
								description,
								scheduledAt: scheduled_at,
								endTime: end_time,
								channelId: channelId,
								messageTs: "",
							})
							.returning({ id: meetingTable.id })
							.get();
						const row = rowResult ? { id: rowResult.id } : undefined;
						if (!row) continue;
						const post = await postWithJoin(client, channelId, {
							channel: channelId,
							text: `New meeting: ${name}`,
							blocks: buildAnnouncementBlocks(
								{ id: row.id, name, description, scheduled_at, end_time },
								{ yes: [], maybe: [], no: [] },
							),
						});
						await db
							.update(meetingTable)
							.set({
								// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
								channelId: (post as any).channel,
								// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
								messageTs: (post as any).ts,
							})
							.where(eq(meetingTable.id, row.id))
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
					const db = drizzle(env.DB);
					const rowResult = await db
						.insert(meetingTable)
						.values({
							name,
							description,
							scheduledAt: scheduled_at,
							endTime: end_time,
							channelId: channelId,
							messageTs: "",
						})
						.returning({ id: meetingTable.id })
						.get();
					const row = rowResult ? { id: rowResult.id } : undefined;
					if (!row) return;
					const post = await postWithJoin(client, channelId, {
						channel: channelId,
						text: `New meeting: ${name}`,
						blocks: buildAnnouncementBlocks(
							{ id: row.id, name, description, scheduled_at, end_time },
							{ yes: [], maybe: [], no: [] },
						),
					});
					await db
						.update(meetingTable)
						.set({
							// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
							channelId: (post as any).channel,
							// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
							messageTs: (post as any).ts,
						})
						.where(eq(meetingTable.id, row.id))
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

				const db = drizzle(env.DB);
				await db
					.update(meetingTable)
					.set({
						name,
						description,
						scheduledAt: scheduled_at,
						endTime: end_time,
						channelId: channelId,
					})
					.where(eq(meetingTable.id, meetingId))
					.run();

				const meeting = await db
					.select({
						id: meetingTable.id,
						name: meetingTable.name,
						description: meetingTable.description,
						scheduled_at: meetingTable.scheduledAt,
						end_time: meetingTable.endTime,
						channel_id: meetingTable.channelId,
						message_ts: meetingTable.messageTs,
						cancelled: meetingTable.cancelled,
					})
					.from(meetingTable)
					.where(eq(meetingTable.id, meetingId))
					.get();

				if (meeting) await updateAnnouncement(req.context.client, env, meeting);
			} catch (err) {
				console.error("meetings_edit error:", err);
			}
		},
	);

	for (const status of ["yes", "maybe", "no"] as const) {
		slackApp.action(`rsvp_${status}`, async ({ context, payload }) => {
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
			const value = (payload as any).actions?.[0]?.value;
			if (!value) return;
			const meetingId = Number(value);
			const db = drizzle(env.DB);
			const meeting = await db
				.select({ name: meetingTable.name })
				.from(meetingTable)
				.where(eq(meetingTable.id, meetingId))
				.get();
			await context.client.views.open({
				// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
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

				const db = drizzle(env.DB);
				await db
					.insert(attendance)
					.values({
						meetingId,
						userId,
						// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
						status: status as any,
						note,
					})
					.onConflictDoUpdate({
						target: [attendance.meetingId, attendance.userId],
						// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
						set: { status: status as any, note },
					})
					.run();

				const [attendanceRows, meeting] = await Promise.all([
					db
						.select({ user_id: attendance.userId, status: attendance.status })
						.from(attendance)
						.where(eq(attendance.meetingId, meetingId))
						.all(),
					db
						.select({
							id: meetingTable.id,
							name: meetingTable.name,
							description: meetingTable.description,
							scheduled_at: meetingTable.scheduledAt,
							end_time: meetingTable.endTime,
							channel_id: meetingTable.channelId,
							message_ts: meetingTable.messageTs,
						})
						.from(meetingTable)
						.where(eq(meetingTable.id, meetingId))
						.get(),
				]);

				const attendees = {
					yes: [] as string[],
					maybe: [] as string[],
					no: [] as string[],
				};
				for (const row of attendanceRows) {
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
