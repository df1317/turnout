import type { SlackAPIClient } from "slack-web-api-client";

/**
 * Post a message to a channel, joining first if the bot isn't already a member.
 * Throws a descriptive error if the bot can't access the channel (e.g. private
 * channel the bot hasn't been added to).
 */
export async function postWithJoin(
	client: SlackAPIClient,
	channelId: string,
	// biome-ignore lint/suspicious/noExplicitAny: Slack message types are incomplete
	message: any,
	// biome-ignore lint/suspicious/noExplicitAny: Slack response types are incomplete
): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: Slack error types are incomplete
	return client.chat.postMessage(message).catch(async (err: any) => {
		if (err?.error !== "not_in_channel") throw err;
		try {
			await client.conversations.join({ channel: channelId });
		} catch (joinErr: unknown) {
			const error = joinErr as { error?: string };
			if (
				error?.error === "channel_not_found" ||
				error?.error === "is_archived"
			) {
				throw new Error(
					`Cannot post to channel ${channelId}: the channel may be private and the bot hasn't been added to it, or it may not exist. Add the bot to the channel and try again.`,
				);
			}
			if (error?.error === "missing_scope" || error?.error === "not_allowed") {
				throw new Error(
					`Cannot post to channel ${channelId}: the bot lacks permission to join channels. Check the bot's scopes.`,
				);
			}
			throw joinErr;
		}
		return client.chat.postMessage(message);
	});
}

/**
 * Flatten Slack Block Kit state_values into a single key-value map.
 */
// biome-ignore lint/suspicious/noExplicitAny: Slack block state shapes are dynamic and untyped
export function flattenState(
	stateValues: Record<string, Record<string, any>>,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Slack block state shapes are dynamic and untyped
	const flat: Record<string, any> = {};
	for (const blockState of Object.values(stateValues)) {
		for (const [actionId, val] of Object.entries(blockState)) {
			flat[actionId] = val;
		}
	}
	return flat;
}

/**
 * Convert a name to a URL/Slack-safe slug.
 * Optionally append a suffix (e.g. "-cdt").
 */
export function slugify(name: string, suffix = ""): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return suffix ? `${base}${suffix}` : base;
}
