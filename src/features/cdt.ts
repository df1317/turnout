import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import { SlackAPIClient } from "slack-web-api-client";
import { cdtMember, cdt as cdtTable, slackUser } from "../db/schema";
import type { Env } from "../index";
import { deleteSlackUsergroup, getCdtFieldId } from "../lib/slack-cdt";
import { flattenState, slugify } from "../lib/slack-utils";
import { isAdmin, setProfile } from "../lib/users";

function buildListModal(
	cdts: { id: string; name: string; handle: string; member_count: number }[],
	adminUser: boolean,
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
): any {
	const blocks: Record<string, unknown>[] = [];

	if (cdts.length === 0) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: "_No CDTs yet._" },
		});
	} else {
		for (const c of cdts) {
			const block: Record<string, unknown> = {
				type: "section",
				text: {
					type: "mrkdwn",
					text: `*${c.name}*  <!subteam^${c.id}|@${c.handle}>\n${c.member_count} members`,
				},
			};
			if (adminUser) {
				block.accessory = {
					type: "button",
					text: { type: "plain_text", text: "Edit" },
					action_id: "cdt_open_edit",
					value: c.id,
				};
			}
			blocks.push(block);
		}
	}

	return {
		type: "modal",
		callback_id: "cdt_list",
		title: { type: "plain_text", text: "Component Design Teams" },
		close: { type: "plain_text", text: "Close" },
		...(adminUser
			? { submit: { type: "plain_text", text: "Create CDT" } }
			: {}),
		blocks,
	};
}

// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
function buildCreateModal(): any {
	return {
		type: "modal",
		callback_id: "cdt_create",
		title: { type: "plain_text", text: "Create CDT" },
		submit: { type: "plain_text", text: "Create" },
		close: { type: "plain_text", text: "Back" },
		blocks: [
			{
				type: "input",
				block_id: "name_block",
				element: { type: "plain_text_input", action_id: "cdt_name" },
				label: { type: "plain_text", text: "CDT Name" },
			},
			{
				type: "input",
				block_id: "channel_block",
				element: { type: "channels_select", action_id: "cdt_channel" },
				label: { type: "plain_text", text: "Channel" },
			},
			{
				type: "input",
				block_id: "members_block",
				element: {
					type: "multi_users_select",
					action_id: "cdt_members",
					placeholder: { type: "plain_text", text: "Select members" },
				},
				label: { type: "plain_text", text: "Members" },
				optional: true,
			},
		],
	};
}

function buildEditModal(
	cdtRow: { id: string; name: string; channel_id: string },
	memberIds: string[],
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
): any {
	return {
		type: "modal",
		callback_id: "cdt_edit",
		private_metadata: JSON.stringify({ cdtId: cdtRow.id }),
		title: { type: "plain_text", text: "Edit CDT" },
		submit: { type: "plain_text", text: "Save" },
		close: { type: "plain_text", text: "Back" },
		blocks: [
			{
				type: "input",
				block_id: "name_block",
				element: {
					type: "plain_text_input",
					action_id: "cdt_name",
					initial_value: cdtRow.name,
				},
				label: { type: "plain_text", text: "CDT Name" },
			},
			{
				type: "input",
				block_id: "channel_block",
				element: {
					type: "channels_select",
					action_id: "cdt_channel",
					initial_channel: cdtRow.channel_id,
				},
				label: { type: "plain_text", text: "Channel" },
			},
			{
				type: "input",
				block_id: "members_block",
				element: {
					type: "multi_users_select",
					action_id: "cdt_members",
					placeholder: { type: "plain_text", text: "Select members" },
					initial_users: memberIds,
				},
				label: { type: "plain_text", text: "Members" },
				optional: true,
			},
			{ type: "divider" },
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: "Delete CDT" },
						action_id: "cdt_delete",
						value: cdtRow.id,
						style: "danger",
						confirm: {
							title: { type: "plain_text", text: "Delete CDT?" },
							text: {
								type: "mrkdwn",
								text: `This will permanently remove *${cdtRow.name}* from all member profiles and free up the name in Slack.`,
							},
							confirm: { type: "plain_text", text: "Delete" },
							deny: { type: "plain_text", text: "Cancel" },
							style: "danger",
						},
					},
				],
			},
		],
	};
}

const cdt = async (slackApp: SlackApp<SlackEdgeAppEnv>, env: Env) => {
	slackApp.command("/cdt", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		const db = drizzle(env.DB);
		const [adminUser, cdts] = await Promise.all([
			isAdmin(env.DB, context.client, userId),
			db
				.select({
					id: cdtTable.id,
					name: cdtTable.name,
					handle: cdtTable.handle,
					member_count: count(cdtMember.userId),
				})
				.from(cdtTable)
				.leftJoin(cdtMember, eq(cdtTable.id, cdtMember.cdtId))
				.groupBy(cdtTable.id)
				.orderBy(cdtTable.name),
		]);

		await context.client.views.open({
			trigger_id: payload.trigger_id,
			view: buildListModal(cdts, adminUser),
		});
	});

	slackApp.viewSubmission("cdt_list", async () => ({
		response_action: "push",
		view: buildCreateModal(),
	}));

	slackApp.action("cdt_open_edit", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const payloadActions = (payload as { actions?: { value: string }[] })
			.actions;
		const value = payloadActions?.[0]?.value;
		if (!value) return;
		const cdtId = String(value);

		const db = drizzle(env.DB);

		const cdtRow = await db
			.select({
				id: cdtTable.id,
				name: cdtTable.name,
				channel_id: cdtTable.channelId,
			})
			.from(cdtTable)
			.where(eq(cdtTable.id, cdtId))
			.get();

		if (!cdtRow) return;

		const members = await db
			.select({ user_id: cdtMember.userId })
			.from(cdtMember)
			.where(eq(cdtMember.cdtId, cdtId))
			.all();

		await context.client.views.push({
			trigger_id: (payload as { trigger_id: string }).trigger_id,
			view: buildEditModal(
				cdtRow,
				members.map((r) => r.user_id),
			),
		});
	});

	slackApp.action("cdt_delete", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const payloadActions = (payload as { actions?: { value: string }[] })
			.actions;
		const value = payloadActions?.[0]?.value;
		if (!value) return;
		const cdtId = String(value);

		const db = drizzle(env.DB);
		const cdtRow = await db
			.select({ id: cdtTable.id, name: cdtTable.name, handle: cdtTable.handle })
			.from(cdtTable)
			.where(eq(cdtTable.id, cdtId))
			.get();
		if (!cdtRow) return;

		const members = await db
			.select({ user_id: cdtMember.userId })
			.from(cdtMember)
			.where(eq(cdtMember.cdtId, cdtId))
			.all();

		const adminClient = new SlackAPIClient(env.SLACK_ADMIN_TOKEN);

		await Promise.all([
			deleteSlackUsergroup(adminClient, cdtId, cdtRow.name, cdtRow.handle),
			...members.map(({ user_id }) =>
				setProfile(adminClient, user_id, { [getCdtFieldId(env)]: "" }),
			),
		]);

		await db.delete(cdtTable).where(eq(cdtTable.id, cdtId)).run();

		const [freshCdts] = await Promise.all([
			db
				.select({
					id: cdtTable.id,
					name: cdtTable.name,
					handle: cdtTable.handle,
					member_count: count(slackUser.userId),
				})
				.from(cdtTable)
				.leftJoin(cdtMember, eq(cdtTable.id, cdtMember.cdtId))
				.leftJoin(slackUser, eq(cdtMember.userId, slackUser.userId))
				.groupBy(cdtTable.id)
				.orderBy(cdtTable.name),
		]);

		const rootViewId = (payload as { view: { root_view_id: string } }).view
			.root_view_id;
		await Promise.all([
			context.client.views.update({
				view_id: (payload as { view: { id: string } }).view.id,
				view: {
					type: "modal",
					callback_id: "cdt_deleted",
					title: { type: "plain_text", text: "CDT Deleted" },
					close: { type: "plain_text", text: "Close" },
					blocks: [
						{
							type: "section",
							text: {
								type: "mrkdwn",
								text: `*${cdtRow.name}* has been deleted and removed from all member profiles.`,
							},
						},
					],
				},
			}),
			rootViewId
				? context.client.views.update({
						view_id: rootViewId,
						view: buildListModal(freshCdts, true),
					})
				: Promise.resolve(),
		]);
	});

	slackApp.viewSubmission(
		"cdt_create",
		async (req) => {
			const flat = flattenState(req.payload.view.state.values);
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
			const name: string = (flat.cdt_name as any)?.value ?? "";
			const handle = slugify(name, "-cdt");

			const db = drizzle(env.DB);
			const [existingName, ugList] = await Promise.all([
				db
					.select({ id: cdtTable.id })
					.from(cdtTable)
					.where(eq(cdtTable.name, name))
					.get(),
				req.context.client.usergroups.list({
					include_disabled: true,
					include_users: true,
				}),
			]);

			if (existingName) {
				return {
					response_action: "errors",
					errors: { name_block: "A CDT with this name already exists." },
				};
			}

			const usergroups =
				(ugList as { usergroups?: { handle?: string; name?: string }[] })
					.usergroups ?? [];
			const existingUg = usergroups.find(
				(ug) => ug.handle === handle || ug.name === name,
			);

			if (existingUg) {
				return {
					response_action: "errors",
					errors: {
						name_block:
							"A Slack usergroup with this name or handle already exists.",
					},
				};
			}

			return { response_action: "clear" };
		},
		async (req) => {
			try {
				const flat = flattenState(req.payload.view.state.values);
				// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
				const name: string = (flat.cdt_name as any)?.value ?? "";
				const channelId: string =
					// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
					(flat.cdt_channel as any)?.selected_channel ?? "";
				const members: string[] =
					// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
					(flat.cdt_members as any)?.selected_users ?? [];
				const handle = slugify(name, "-cdt");

				const db = drizzle(env.DB);
				const adminClient = new SlackAPIClient(env.SLACK_ADMIN_TOKEN);

				const ugRes = await adminClient.usergroups.create({
					name,
					handle,
					channels: channelId,
				});
				const usergroupId = (ugRes as { usergroup: { id: string } }).usergroup
					.id;

				await db
					.insert(cdtTable)
					.values({
						id: usergroupId,
						name,
						handle,
						channelId,
					})
					.run();

				for (const userId of members) {
					await db
						.insert(cdtMember)
						.values({ userId, cdtId: usergroupId })
						.onConflictDoUpdate({
							target: cdtMember.userId,
							set: { cdtId: usergroupId },
						})
						.run();
					await setProfile(adminClient, userId, { [getCdtFieldId(env)]: name });
				}

				if (members.length > 0) {
					await adminClient.usergroups.users.update({
						usergroup: usergroupId,
						users: members,
					});
				}

				await req.context.client.chat
					.postMessage({
						channel: channelId,
						text: `<!subteam^${usergroupId}> has been created. Welcome to *${name}*!`,
					})
					.catch(async (err: unknown) => {
						const error = err as { error?: string };
						if (error?.error !== "not_in_channel") throw err;
						await req.context.client.conversations.join({ channel: channelId });
						await req.context.client.chat.postMessage({
							channel: channelId,
							text: `<!subteam^${usergroupId}> has been created. Welcome to *${name}*!`,
						});
					});
			} catch (err) {
				console.error("cdt_create error:", err);
			}
		},
	);

	slackApp.viewSubmission(
		"cdt_edit",
		async () => ({ response_action: "clear" }),
		async (req) => {
			try {
				const { cdtId } = JSON.parse(req.payload.view.private_metadata ?? "{}");
				const flat = flattenState(req.payload.view.state.values);
				// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
				const newName: string = (flat.cdt_name as any)?.value ?? "";
				const newChannelId: string =
					// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
					(flat.cdt_channel as any)?.selected_channel ?? "";
				const newMembers: string[] =
					// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
					(flat.cdt_members as any)?.selected_users ?? [];

				const db = drizzle(env.DB);
				const currentRows = await db
					.select({ user_id: cdtMember.userId })
					.from(cdtMember)
					.where(eq(cdtMember.cdtId, cdtId))
					.all();
				const currentSet = new Set(currentRows.map((r) => r.user_id));
				const newSet = new Set(newMembers);

				const added = newMembers.filter((id) => !currentSet.has(id));
				const removed = [...currentSet].filter((id) => !newSet.has(id));

				await db
					.update(cdtTable)
					.set({ name: newName, channelId: newChannelId })
					.where(eq(cdtTable.id, cdtId))
					.run();

				const adminClient = new SlackAPIClient(env.SLACK_ADMIN_TOKEN);

				for (const userId of added) {
					await db
						.insert(cdtMember)
						.values({ userId, cdtId })
						.onConflictDoUpdate({ target: cdtMember.userId, set: { cdtId } })
						.run();
					await setProfile(adminClient, userId, {
						[getCdtFieldId(env)]: newName,
					});
				}

				for (const userId of removed) {
					await db.delete(cdtMember).where(eq(cdtMember.userId, userId)).run();
					await setProfile(adminClient, userId, { [getCdtFieldId(env)]: "" });
				}

				await adminClient.usergroups.users.update({
					usergroup: cdtId,
					users: newMembers.length > 0 ? newMembers : "",
				});
			} catch (err) {
				console.error("cdt_edit error:", err);
			}
		},
	);
};

export default cdt;
