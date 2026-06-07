import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { SlackAPIClient } from "slack-web-api-client";
import * as schema from "../../db/schema";
import type { Env } from "../../index";
import type { Session } from "../middleware/session";

type Variables = { session: Session | null };

const adminSettings = new Hono<{ Bindings: Env; Variables: Variables }>();

adminSettings.get("/settings/:key", async (c) => {
	const key = c.req.param("key");
	const db = drizzle(c.env.DB);
	const row = await db
		.select({ value: schema.kvStore.value })
		.from(schema.kvStore)
		.where(eq(schema.kvStore.key, key))
		.get();
	return c.json({ value: row?.value ?? null });
});

adminSettings.post("/settings/:key", async (c) => {
	const key = c.req.param("key");
	const { value } = await c.req.json<{ value: string }>();
	const db = drizzle(c.env.DB);
	await db
		.insert(schema.kvStore)
		.values({ key, value })
		.onConflictDoUpdate({ target: schema.kvStore.key, set: { value } });
	return c.json({ ok: true });
});

adminSettings.get("/slack/channels", async (c) => {
	const now = Math.floor(Date.now() / 1000);
	const db = drizzle(c.env.DB);
	const cached = await db
		.select({
			value: schema.slackCache.value,
			expiresAt: schema.slackCache.expiresAt,
		})
		.from(schema.slackCache)
		.where(eq(schema.slackCache.key, "channels"))
		.get();

	if (cached && cached.expiresAt > now) {
		return c.json(JSON.parse(cached.value));
	}

	const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
	const allChannels: { id: string; name: string; is_private: boolean }[] = [];
	let cursor: string | undefined;

	do {
		const result = (await botClient.conversations.list({
			types: ["public_channel"],
			limit: 1000,
			...(cursor ? { cursor } : {}),
		})) as {
			channels?: {
				id: string;
				name: string;
				is_private: boolean;
				is_archived: boolean;
			}[];
			response_metadata?: { next_cursor: string };
		};

		for (const ch of result.channels ?? []) {
			if (!ch.is_archived) {
				allChannels.push({
					id: ch.id,
					name: ch.name,
					is_private: ch.is_private,
				});
			}
		}
		cursor = result.response_metadata?.next_cursor || undefined;
	} while (cursor);

	allChannels.sort((a, b) => a.name.localeCompare(b.name));

	await db
		.insert(schema.slackCache)
		.values({
			key: "channels",
			value: JSON.stringify(allChannels),
			expiresAt: now + 600,
		})
		.onConflictDoUpdate({
			target: schema.slackCache.key,
			set: { value: JSON.stringify(allChannels), expiresAt: now + 600 },
		});

	return c.json(allChannels);
});

export default adminSettings;
