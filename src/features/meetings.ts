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
import { flattenState, postWithJoin } from "../lib/slack-utils";
import {
	buildCreateModal,
	buildEditModal,
	buildListModal,
	buildRsvpModal,
} from "./meeting-modals";

/** Typed Slack action payload for block actions */
interface BlockActionPayload {
	trigger_id: string;
	actions: {
		action_id: string;
		value?: string;
		selected_options?: { value: string }[];
	}[];
	view?: { id: string; hash: string; root_view_id?: string };
}

/** Typed Slack view submission payload */
interface ViewSubmissionPayload {
	view: {
		id: string;
		private_metadata?: string;
		state: {
			values: Record<string, Record<string, unknown>>;
		};
	};
	user: { id: string };
}

async function refreshListView(
	// biome-ignore lint/suspicious/noExplicitAny: Slack client type is incomplete
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
		const p = payload as BlockActionPayload;
		const value = p.actions?.[0]?.value;
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
			trigger_id: p.trigger_id,
			view: buildEditModal(meetingRow),
		});
	});

	slackApp.action("repeat_toggle", async ({ context, payload }) => {
		const p = payload as BlockActionPayload;
		const isRecurring = (p.actions[0].selected_options?.length ?? 0) > 0;
		await context.client.views.update({
			view_id: p.view!.id,
			hash: p.view!.hash,
			view: buildCreateModal(isRecurring),
		});
	});

	slackApp.action("meeting_cancel", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const p = payload as BlockActionPayload;
		const value = p.actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const rootViewId = p.view?.root_view_id;
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
					view_id: p.view!.id,
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
		const p = payload as BlockActionPayload;
		const value = p.actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const rootViewId = p.view?.root_view_id;
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
					view_id: p.view!.id,
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
		const p = payload as BlockActionPayload;
		const value = p.actions?.[0]?.value;
		if (!value) return;
		const meetingId = Number(value);
		const rootViewId = p.view?.root_view_id;
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
				view_id: p.view!.id,
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
				const p = req.payload as ViewSubmissionPayload;
				const flat = flattenState(p.view.state.values);
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
						(o: { value: string }) => Number(o.value),
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
								channelId: (post as { channel: string }).channel,
								messageTs: (post as { ts: string }).ts,
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
							channelId: (post as { channel: string }).channel,
							messageTs: (post as { ts: string }).ts,
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
				const p = req.payload as ViewSubmissionPayload;
				const { meetingId } = JSON.parse(p.view.private_metadata ?? "{}");
				const flat = flattenState(p.view.state.values);
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
			const p = payload as BlockActionPayload;
			const value = p.actions?.[0]?.value;
			if (!value) return;
			const meetingId = Number(value);
			const db = drizzle(env.DB);
			const meeting = await db
				.select({ name: meetingTable.name })
				.from(meetingTable)
				.where(eq(meetingTable.id, meetingId))
				.get();
			await context.client.views.open({
				trigger_id: p.trigger_id,
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
				const p = req.payload as ViewSubmissionPayload;
				const { meetingId, status } = JSON.parse(
					p.view.private_metadata ?? "{}",
				);
				const flat = flattenState(p.view.state.values);
				const note: string = flat.note?.value ?? "";
				const userId = p.user.id;

				const db = drizzle(env.DB);
				await db
					.insert(attendance)
					.values({
						meetingId,
						userId,
						status: status as "yes" | "maybe" | "no",
						note,
					})
					.onConflictDoUpdate({
						target: [attendance.meetingId, attendance.userId],
						set: { status: status as "yes" | "maybe" | "no", note },
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
