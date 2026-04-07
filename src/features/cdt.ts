import { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import { SlackAPIClient } from "slack-web-api-client";
import type { Env } from "../index";
import { isAdmin, setProfile } from "../lib/users";
import { CDT_FIELD_ID, deleteSlackUsergroup } from "../lib/slack-cdt";

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
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
	cdts: { id: string; name: string; handle: string; member_count: number }[],
	adminUser: boolean,
): any {
	const blocks: any[] = [];

	if (cdts.length === 0) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: "_No CDTs yet._" },
		});
	} else {
		for (const c of cdts) {
			const block: any = {
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
		const [adminUser, cdts] = await Promise.all([
			isAdmin(env.DB, context.client, userId),
			env.DB.prepare(`
        SELECT c.id, c.name, c.handle, COUNT(m.user_id) as member_count
        FROM cdt c LEFT JOIN cdt_member m ON m.cdt_id = c.id
        GROUP BY c.id ORDER BY c.name
      `).all<{
				id: string;
				name: string;
				handle: string;
				member_count: number;
			}>(),
		]);

		await context.client.views.open({
			trigger_id: payload.trigger_id,
			view: buildListModal(cdts.results, adminUser),
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
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const cdtId = String(value);

		const cdtRow = await env.DB.prepare(
			"SELECT id, name, channel_id FROM cdt WHERE id = ?",
		)
			.bind(cdtId)
			.first<{ id: string; name: string; channel_id: string }>();

		if (!cdtRow) return;

		const members = await env.DB.prepare(
			"SELECT user_id FROM cdt_member WHERE cdt_id = ?",
		)
			.bind(cdtId)
			.all<{ user_id: string }>();

		await context.client.views.push({
			trigger_id: (payload as any).trigger_id,
			view: buildEditModal(
				cdtRow,
				members.results.map((r) => r.user_id),
			),
		});
	});

	slackApp.action("cdt_delete", async ({ context, payload }) => {
		const userId = context.userId;
		if (!userId) return;
		if (!(await isAdmin(env.DB, context.client, userId))) return;
		const value = (payload as any).actions?.[0]?.value;
		if (!value) return;
		const cdtId = String(value);

		const cdtRow = await env.DB.prepare(
			"SELECT id, name, handle FROM cdt WHERE id = ?",
		)
			.bind(cdtId)
			.first<{ id: string; name: string; handle: string }>();
		if (!cdtRow) return;

		const members = await env.DB.prepare(
			"SELECT user_id FROM cdt_member WHERE cdt_id = ?",
		)
			.bind(cdtId)
			.all<{ user_id: string }>();

		const adminClient = new SlackAPIClient(env.SLACK_ADMIN_TOKEN);

		await Promise.all([
			deleteSlackUsergroup(adminClient, cdtId, cdtRow.name, cdtRow.handle),
			...members.results.map(({ user_id }) =>
				setProfile(adminClient, user_id, { [CDT_FIELD_ID]: "" }),
			),
		]);

		await env.DB.prepare("DELETE FROM cdt WHERE id = ?").bind(cdtId).run();

		const [freshCdts] = await Promise.all([
			env.DB.prepare(`
        SELECT c.id, c.name, c.handle, COUNT(u.user_id) as member_count
        FROM cdt c 
        LEFT JOIN cdt_member m ON m.cdt_id = c.id
        LEFT JOIN slack_user u ON u.user_id = m.user_id
        GROUP BY c.id ORDER BY c.name
      `).all<{
				id: string;
				name: string;
				handle: string;
				member_count: number;
			}>(),
		]);

		const rootViewId = (payload as any).view.root_view_id;
		await Promise.all([
			context.client.views.update({
				view_id: (payload as any).view.id,
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
						view: buildListModal(freshCdts.results, true),
					})
				: Promise.resolve(),
		]);
	});

	slackApp.viewSubmission(
		"cdt_create",
		async (req) => {
			const flat = flattenState(req.payload.view.state.values);
			const name: string = flat.cdt_name?.value ?? "";
			const handle = slugify(name) + "-cdt";

			const [existingName, ugList] = await Promise.all([
				env.DB.prepare("SELECT id FROM cdt WHERE name = ?").bind(name).first(),
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

			const usergroups: any[] = (ugList as any).usergroups ?? [];
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
				const name: string = flat.cdt_name?.value ?? "";
				const channelId: string = flat.cdt_channel?.selected_channel ?? "";
				const members: string[] = flat.cdt_members?.selected_users ?? [];
				const handle = slugify(name) + "-cdt";

				const adminClient = new SlackAPIClient(env.SLACK_ADMIN_TOKEN);

				const ugRes = await adminClient.usergroups.create({
					name,
					handle,
					channels: channelId,
				});
				const usergroupId = (ugRes as any).usergroup.id;

				await env.DB.prepare(
					"INSERT INTO cdt (id, name, handle, channel_id) VALUES (?, ?, ?, ?)",
				)
					.bind(usergroupId, name, handle, channelId)
					.run();

				for (const userId of members) {
					await env.DB.prepare(
						"INSERT INTO cdt_member (user_id, cdt_id) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET cdt_id = excluded.cdt_id",
					)
						.bind(userId, usergroupId)
						.run();
					await setProfile(adminClient, userId, { [CDT_FIELD_ID]: name });
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
					.catch(async (err: any) => {
						if (err?.error !== "not_in_channel") throw err;
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
				const newName: string = flat.cdt_name?.value ?? "";
				const newChannelId: string = flat.cdt_channel?.selected_channel ?? "";
				const newMembers: string[] = flat.cdt_members?.selected_users ?? [];

				const currentRows = await env.DB.prepare(
					"SELECT user_id FROM cdt_member WHERE cdt_id = ?",
				)
					.bind(cdtId)
					.all<{ user_id: string }>();
				const currentSet = new Set(currentRows.results.map((r) => r.user_id));
				const newSet = new Set(newMembers);

				const added = newMembers.filter((id) => !currentSet.has(id));
				const removed = [...currentSet].filter((id) => !newSet.has(id));

				await env.DB.prepare(
					"UPDATE cdt SET name = ?, channel_id = ? WHERE id = ?",
				)
					.bind(newName, newChannelId, cdtId)
					.run();

				const adminClient = new SlackAPIClient(env.SLACK_ADMIN_TOKEN);

				for (const userId of added) {
					await env.DB.prepare(
						"INSERT INTO cdt_member (user_id, cdt_id) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET cdt_id = excluded.cdt_id",
					)
						.bind(userId, cdtId)
						.run();
					await setProfile(adminClient, userId, { [CDT_FIELD_ID]: newName });
				}

				for (const userId of removed) {
					await env.DB.prepare(
						"DELETE FROM cdt_member WHERE user_id = ? AND cdt_id = ?",
					)
						.bind(userId, cdtId)
						.run();
					await setProfile(adminClient, userId, { [CDT_FIELD_ID]: "" });
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
