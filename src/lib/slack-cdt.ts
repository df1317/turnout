import { SlackAPIClient } from "slack-web-api-client";
import { setProfile } from "./users";

export const CDT_FIELD_ID = "Xf040HCJKNJZ";

export async function syncCdtUsers(
	db: D1Database,
	adminClient: SlackAPIClient,
	cdtId: string,
) {
	const cdtRow = await db
		.prepare("SELECT name FROM cdt WHERE id = ?")
		.bind(cdtId)
		.first<{ name: string }>();
	
	if (!cdtRow) return;

	const members = await db
		.prepare("SELECT user_id FROM cdt_member WHERE cdt_id = ?")
		.bind(cdtId)
		.all<{ user_id: string }>();
	
	const memberIds = members.results.map((r) => r.user_id);

	await adminClient.usergroups.users.update({
		usergroup: cdtId,
		users: memberIds.length > 0 ? memberIds.join(",") : " ",
	}).catch((err: any) => {
		if (err?.error !== "invalid_arguments" && err?.error !== "not_found") {
			console.error(`Failed to update usergroup users for ${cdtId}:`, err);
		}
	});

	for (const userId of memberIds) {
		await setProfile(adminClient, userId, { [CDT_FIELD_ID]: cdtRow.name });
	}
}

export async function clearCdtProfile(
	adminClient: SlackAPIClient,
	userId: string,
) {
	await setProfile(adminClient, userId, { [CDT_FIELD_ID]: "" });
}

export async function sendWelcomeMessage(
	adminClient: SlackAPIClient,
	cdtId: string,
	channelId: string,
	name: string,
) {
	await adminClient.chat
		.postMessage({
			channel: channelId,
			text: `<!subteam^${cdtId}> has been created. Welcome to *${name}*!`,
		})
		.catch(async (err: any) => {
			if (err?.error !== "not_in_channel") throw err;
			await adminClient.conversations.join({ channel: channelId });
			await adminClient.chat.postMessage({
				channel: channelId,
				text: `<!subteam^${cdtId}> has been created. Welcome to *${name}*!`,
			});
		});
}

export async function deleteSlackUsergroup(
	adminClient: SlackAPIClient,
	cdtId: string,
	currentName: string,
	currentHandle: string,
) {
	for (let i = 0; i < 5; i++) {
		const suffix = Math.random().toString(36).slice(2, 7);
		try {
			await adminClient.usergroups.update({
				usergroup: cdtId,
				name: `${currentName} [deleted-${suffix}]`,
				handle: `${currentHandle}-${suffix}`,
			});
			await adminClient.usergroups.disable({ usergroup: cdtId });
			return;
		} catch (err: any) {
			if (err?.error !== "name_already_exists") {
				console.warn("deleteSlackUsergroup: update skipped:", err.message);
				return;
			}
		}
	}
	console.warn("deleteSlackUsergroup: update failed after 5 retries");
}
