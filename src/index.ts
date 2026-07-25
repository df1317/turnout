import { SlackApp, type SlackEdgeAppEnv } from "slack-cloudflare-workers";
import * as features from "./features/index";
import {
	checkPendingMeetings,
	flushPendingAnnouncements,
} from "./lib/announcements";
import { createWebApp } from "./web/app";
import { syncAllUsers } from "./web/lib/sync";

export type Env = SlackEdgeAppEnv & {
	DB: D1Database;
	SLACK_ADMIN_TOKEN: string;
	SLACK_CLIENT_ID: string;
	SLACK_CLIENT_SECRET: string;
	HOST: string;
	SLACK_TEAM_ID?: string;
	SLACK_PROFILE_FIELD_CDT?: string;
	SLACK_PROFILE_FIELD_ROLE?: string;
};

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/slack")) {
			// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
			const slackApp = new SlackApp({ env: env as any });
			for (const [_feature, handler] of Object.entries(features)) {
				// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
				if (typeof handler === "function") await handler(slackApp as any, env);
			}
			return await slackApp.run(request, ctx);
		}

		return createWebApp(env).fetch(request, env, ctx);
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(flushPendingAnnouncements(env));

		if (event.cron === "0 6 * * *") {
			ctx.waitUntil(syncAllUsers(env.DB, env.SLACK_ADMIN_TOKEN));
			ctx.waitUntil(checkPendingMeetings(env));
		}
	},
};
