import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { slackTokenLink, webSession } from "../../db/schema";
import type { Env } from "../../index";

/**
 * Exchanges a Slack token link for a web session
 * @param db D1Database instance
 * @param token The token from the ?token= query parameter
 * @returns The session token if valid, null otherwise
 */
export async function exchangeSlackToken(
	db: D1Database,
	token: string,
): Promise<string | null> {
	const now = Math.floor(Date.now() / 1000);

	// Look up the token and verify it hasn't expired
	const tokenRecord = await drizzle(db)
		.select({
			userId: slackTokenLink.userId,
			expiresAt: slackTokenLink.expiresAt,
		})
		.from(slackTokenLink)
		.where(and(eq(slackTokenLink.token, token), gt(slackTokenLink.expiresAt, now)))
		.get();

	if (!tokenRecord) {
		return null;
	}

	// Generate a new web session
	const sessionId =
		crypto.randomUUID().replace(/-/g, "") +
		crypto.randomUUID().replace(/-/g, "");

	const sessionExpiresAt = now + 30 * 24 * 60 * 60; // 30 days

	await drizzle(db)
		.insert(webSession)
		.values({
			id: sessionId,
			userId: tokenRecord.userId,
			expiresAt: sessionExpiresAt,
		})
		.run();

	// Delete the used token
	await drizzle(db).delete(slackTokenLink).where(eq(slackTokenLink.token, token)).run();

	return sessionId;
}

/**
 * Cleans up expired slack token links
 */
export async function cleanupExpiredTokens(db: D1Database): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await drizzle(db)
		.delete(slackTokenLink)
		.where(gt(slackTokenLink.expiresAt, now))
		.run();
}
