import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SlackAPIClient } from "slack-web-api-client";
import { cdt, cdtMember } from "../db/schema";
import type { Env } from "../index";
import { setProfile } from "./users";

export function getCdtFieldId(bindings: Env) {
	if (!bindings.SLACK_PROFILE_FIELD_CDT) {
		throw new Error("SLACK_PROFILE_FIELD_CDT binding is required");
	}
	return bindings.SLACK_PROFILE_FIELD_CDT;
}

export async function syncCdtUsers(
	d1: D1Database,
	adminClient: SlackAPIClient,
	cdtId: string,
	bindings: Env,
) {
	const db = drizzle(d1);
	const cdtRows = await db
		.select({ name: cdt.name })
		.from(cdt)
		.where(eq(cdt.id, cdtId))
		.limit(1);
	const cdtRow = cdtRows[0];

	if (!cdtRow) return;

	const members = await db
		.select({ user_id: cdtMember.userId })
		.from(cdtMember)
		.where(eq(cdtMember.cdtId, cdtId));

	const memberIds = members.map((r) => r.user_id);

	await adminClient.usergroups.users
		.update({
			usergroup: cdtId,
			users: memberIds.length > 0 ? memberIds.join(",") : " ",
		})
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		.catch((err: any) => {
			if (err?.error !== "invalid_arguments" && err?.error !== "not_found") {
				console.error(`Failed to update usergroup users for ${cdtId}:`, err);
			}
		});

	for (const userId of memberIds) {
		await setProfile(adminClient, userId, {
			[getCdtFieldId(bindings)]: cdtRow.name,
		});
	}
}

export async function clearCdtProfile(
	adminClient: SlackAPIClient,
	userId: string,
	bindings: Env,
) {
	await setProfile(adminClient, userId, { [getCdtFieldId(bindings)]: "" });
}

export async function sendWelcomeMessage(
	botClient: SlackAPIClient,
	cdtId: string,
	channelId: string,
	name: string,
) {
	await botClient.chat
		.postMessage({
			channel: channelId,
			text: `<!subteam^${cdtId}> has been created. Welcome to *${name}*!`,
		})
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		.catch(async (err: any) => {
			if (err?.error !== "not_in_channel") throw err;
			await botClient.conversations.join({ channel: channelId });
			await botClient.chat.postMessage({
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
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		} catch (err: any) {
			if (err?.error !== "name_already_exists") {
				console.warn("deleteSlackUsergroup: update skipped:", err.message);
				return;
			}
		}
	}
	console.warn("deleteSlackUsergroup: update failed after 5 retries");
}
