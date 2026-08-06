import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SlackAPIClient } from "slack-web-api-client";
import { slackUser } from "../db/schema";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export interface SlackUser {
	user_id: string;
	name: string;
	avatar_url: string;
	is_admin: number;
	role: string | null;
	last_synced: number;
}

export async function getUser(
	d1: D1Database,
	client: SlackAPIClient,
	userId: string,
): Promise<SlackUser> {
	const db = drizzle(d1);
	const now = Math.floor(Date.now() / 1000);
	const cachedRows = await db
		.select()
		.from(slackUser)
		.where(eq(slackUser.userId, userId))
		.limit(1);
	const cached = cachedRows[0];

	if (cached && now - cached.lastSynced < SEVEN_DAYS) {
		return {
			user_id: cached.userId,
			name: cached.name,
			avatar_url: cached.avatarUrl,
			is_admin: cached.isAdmin,
			role: cached.role,
			last_synced: cached.lastSynced,
		};
	}

	const result = await client.users.info({ user: userId });
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	const u = result.user as any;
	const name =
		u.real_name ||
		u.profile?.real_name ||
		u.profile?.display_name_normalized ||
		u.name ||
		userId;
	const avatar_url = u.profile?.image_72 ?? "";
	const is_admin = u.is_admin === true || u.is_owner === true ? 1 : 0;

	await db
		.insert(slackUser)
		.values({
			userId,
			name,
			avatarUrl: avatar_url,
			isAdmin: is_admin,
			lastSynced: now,
		})
		.onConflictDoUpdate({
			target: slackUser.userId,
			set: {
				name,
				avatarUrl: avatar_url,
				isAdmin: is_admin,
				lastSynced: now,
			},
		});

	return {
		user_id: userId,
		name,
		avatar_url,
		is_admin,
		role: cached?.role ?? null,
		last_synced: now,
	};
}

/** IANA timezone the user has set in Slack, falling back to UTC. */
export async function getUserTimeZone(
	client: SlackAPIClient,
	userId: string,
): Promise<string> {
	const result = await client.users
		.info({ user: userId })
		.catch(() => undefined);
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	return (result?.user as any)?.tz || "UTC";
}

export async function setProfile(
	adminClient: SlackAPIClient,
	userId: string,
	profile: Record<string, string>,
): Promise<void> {
	await adminClient.users.profile
		.set({ user: userId, profile })
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
		.catch((err: any) => {
			if (err?.error === "cannot_update_admin_user") {
				console.log(`setProfile: skipped admin user ${userId}`);
				return;
			}
			if (err?.error === "user_not_found" || err?.error === "not_authed") {
				console.log(`setProfile: skipped invalid or missing user ${userId}`);
				return;
			}
			throw err;
		});
}

export async function isAdmin(
	db: D1Database,
	client: SlackAPIClient,
	userId: string,
): Promise<boolean> {
	const user = await getUser(db, client, userId);
	return user.is_admin === 1;
}
