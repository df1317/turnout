import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SlackAPIClient } from "slack-web-api-client";
import { slackUser, webSession } from "../../db/schema";
import type { Env } from "../../index";
import { buildOAuthUrl, exchangeCode } from "../lib/auth";

const auth = new Hono<{ Bindings: Env }>();

auth.get("/login", (c) => {
	const state = crypto.randomUUID();
	setCookie(c, "oauth_state", state, {
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		maxAge: 300,
	});
	return c.json({ url: buildOAuthUrl(c.env, state) });
});

auth.get("/callback", async (c) => {
	const { code, state, error } = c.req.query();

	if (error) return c.redirect(`/?error=${encodeURIComponent(error)}`);

	const savedState = getCookie(c, "oauth_state");
	deleteCookie(c, "oauth_state");
	if (!savedState || savedState !== state)
		return c.redirect("/?error=invalid_state");

	try {
		const { userId, name, avatarUrl, teamId } = await exchangeCode(c.env, code);

		if (c.env.SLACK_TEAM_ID && teamId !== c.env.SLACK_TEAM_ID) {
			return c.redirect(`/?error=${encodeURIComponent("wrong_workspace")}`);
		}

		const now = Math.floor(Date.now() / 1000);

		// Check if user is an admin by querying Slack API with bot token
		const botClient = new SlackAPIClient(c.env.SLACK_BOT_TOKEN);
		const userInfo = await botClient.users.info({ user: userId });
		// biome-ignore lint/suspicious/noExplicitAny: Slack types are not fully mapped here
		const userAny = userInfo.user as any;
		const is_admin = userAny?.is_admin || userAny?.is_owner ? 1 : 0;

		const db = drizzle(c.env.DB);

		await db
			.insert(slackUser)
			.values({
				userId,
				name,
				avatarUrl,
				isAdmin: is_admin,
				lastSynced: now,
			})
			.onConflictDoUpdate({
				target: slackUser.userId,
				set: {
					name,
					avatarUrl,
					isAdmin: is_admin,
					lastSynced: now,
				},
			});

		const sessionId =
			crypto.randomUUID().replace(/-/g, "") +
			crypto.randomUUID().replace(/-/g, "");

		await db.insert(webSession).values({
			id: sessionId,
			userId,
			expiresAt: now + 30 * 24 * 60 * 60,
		});

		setCookie(c, "session", sessionId, {
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
			maxAge: 30 * 24 * 60 * 60,
		});
		return c.redirect("/");
	} catch (err) {
		console.error("OAuth callback error:", err);
		return c.redirect("/?error=server_error");
	}
});

auth.post("/logout", async (c) => {
	const token = getCookie(c, "session");
	if (token) {
		const db = drizzle(c.env.DB);
		await db.delete(webSession).where(eq(webSession.id, token));
	}
	deleteCookie(c, "session");
	return c.json({ ok: true });
});

export default auth;
