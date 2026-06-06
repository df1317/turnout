import { and, count, sql as drizzleSql, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { SlackAPIClient } from "slack-web-api-client";
import * as schema from "../../db/schema";
import type { Env } from "../../index";
import {
	clearCdtProfile,
	deleteSlackUsergroup,
	sendWelcomeMessage,
	syncCdtUsers,
} from "../../lib/slack-cdt";
import type { Session } from "../middleware/session";

type Variables = { session: Session | null };

import { slugify } from "../../lib/slack-utils";

const adminCdts = new Hono<{ Bindings: Env; Variables: Variables }>();

adminCdts.get("/", async (c) => {
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
			channel_id: schema.cdt.channelId,
			member_count: count(schema.slackUser.userId),
		})
		.from(schema.cdt)
		.leftJoin(schema.cdtMember, eq(schema.cdtMember.cdtId, schema.cdt.id))
		.leftJoin(
			schema.slackUser,
			eq(schema.slackUser.userId, schema.cdtMember.userId),
		)
		.groupBy(schema.cdt.id)
		.orderBy(drizzleSql`${schema.cdt.name} COLLATE NOCASE`)
		.all();
	return c.json(rows);
});

adminCdts.get("/:id", async (c) => {
	const id = c.req.param("id");
	const db = drizzle(c.env.DB);
	const cdtRow = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
			channel_id: schema.cdt.channelId,
		})
		.from(schema.cdt)
		.where(eq(schema.cdt.id, id))
		.get();
	if (!cdtRow) return c.json({ error: "Not found" }, 404);

	const members = await db
		.select({
			user_id: schema.slackUser.userId,
			name: schema.slackUser.name,
			avatar_url: schema.slackUser.avatarUrl,
		})
		.from(schema.cdtMember)
		.innerJoin(
			schema.slackUser,
			eq(schema.slackUser.userId, schema.cdtMember.userId),
		)
		.where(eq(schema.cdtMember.cdtId, id))
		.orderBy(drizzleSql`${schema.slackUser.name} COLLATE NOCASE`)
		.all();

	return c.json({
		...cdtRow,
		member_count: members.length,
		members,
	});
});

adminCdts.post("/", async (c) => {
	const { name, handle, channel_id } = await c.req.json<{
		name: string;
		handle?: string;
		channel_id?: string;
	}>();
	if (!name) return c.json({ error: "Name is required" }, 400);
	const finalHandle = handle || slugify(name, "-cdt");

	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);
	let result: { usergroup?: { id: string } } | undefined;
	try {
		result = (await adminClient.usergroups.create({
			name,
			handle: finalHandle,
			...(channel_id ? { channels: channel_id } : {}),
		})) as { usergroup?: { id: string } };
	} catch (err: unknown) {
		const error = err as { error?: string };
		if (error?.error === "name_already_exists") {
			return c.json(
				{
					error: "A Slack usergroup with this name or handle already exists.",
				},
				400,
			);
		}
		return c.json(
			{ error: error?.error || "Failed to create Slack usergroup" },
			500,
		);
	}

	const groupId = result?.usergroup?.id;
	if (!groupId)
		return c.json({ error: "Failed to create Slack usergroup" }, 500);

	const db = drizzle(c.env.DB);
	await db.insert(schema.cdt).values({
		id: groupId,
		name,
		handle: finalHandle,
		channelId: channel_id ?? "",
	});

	const cdtRow = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
			channel_id: schema.cdt.channelId,
		})
		.from(schema.cdt)
		.where(eq(schema.cdt.id, groupId))
		.get();

	if (channel_id && groupId) {
		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		await sendWelcomeMessage(botClient, groupId, channel_id, name);
	}

	return c.json({ ...cdtRow, member_count: 0 }, 201);
});

adminCdts.put("/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<{
		name?: string;
		channel_id?: string;
		members?: string[];
	}>();
	const db = drizzle(c.env.DB);

	// biome-ignore lint/suspicious/noExplicitAny: dynamic update set
	const updateSet: Record<string, any> = {};
	if (body.name !== undefined) updateSet.name = body.name;
	if (body.channel_id !== undefined) updateSet.channelId = body.channel_id;

	if (Object.keys(updateSet).length > 0) {
		await db.update(schema.cdt).set(updateSet).where(eq(schema.cdt.id, id));
	}

	if (body.members !== undefined) {
		const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);

		const currentRows = await db
			.select({ user_id: schema.cdtMember.userId })
			.from(schema.cdtMember)
			.where(eq(schema.cdtMember.cdtId, id))
			.all();
		const currentSet = new Set(currentRows.map((r) => r.user_id));
		const newSet = new Set(body.members);

		const added = body.members.filter((uid) => !currentSet.has(uid));
		const removed = [...currentSet].filter((uid) => !newSet.has(uid));

		for (const userId of removed) {
			await db
				.delete(schema.cdtMember)
				.where(
					and(
						eq(schema.cdtMember.userId, userId),
						eq(schema.cdtMember.cdtId, id),
					),
				);
			await clearCdtProfile(adminClient, userId, c.env);
		}

		for (const userId of added) {
			const currentCdt = await db
				.select({ cdt_id: schema.cdtMember.cdtId })
				.from(schema.cdtMember)
				.where(eq(schema.cdtMember.userId, userId))
				.get();

			await db
				.insert(schema.cdtMember)
				.values({ userId, cdtId: id })
				.onConflictDoUpdate({
					target: schema.cdtMember.userId,
					set: { cdtId: id },
				});

			if (currentCdt && currentCdt.cdt_id !== id) {
				await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
			}
		}

		await syncCdtUsers(c.env.DB, adminClient, id, c.env);
	} else if (Object.keys(updateSet).length === 0) {
		return c.json({ error: "No fields to update" }, 400);
	}

	return c.json({ ok: true });
});

adminCdts.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const db = drizzle(c.env.DB);
	const cdtRow = await db
		.select({
			id: schema.cdt.id,
			name: schema.cdt.name,
			handle: schema.cdt.handle,
		})
		.from(schema.cdt)
		.where(eq(schema.cdt.id, id))
		.get();

	if (!cdtRow) return c.json({ error: "Not found" }, 404);

	const members = await db
		.select({ user_id: schema.cdtMember.userId })
		.from(schema.cdtMember)
		.where(eq(schema.cdtMember.cdtId, id))
		.all();

	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);

	await Promise.all([
		deleteSlackUsergroup(adminClient, id, cdtRow.name, cdtRow.handle),
		...members.map(({ user_id }) =>
			clearCdtProfile(adminClient, user_id, c.env),
		),
	]);

	await db.delete(schema.cdt).where(eq(schema.cdt.id, id));
	return c.json({ ok: true });
});

export default adminCdts;
