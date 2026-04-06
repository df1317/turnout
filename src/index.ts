import { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import * as features from "./features/index";
import { createWebApp } from "./web/app";
import { syncAllUsers } from "./web/lib/sync";
import { checkPendingMeetings } from "./lib/announcements";

export type Env = SlackEdgeAppEnv & {
	DB: D1Database;
	SLACK_ADMIN_TOKEN: string;
	SLACK_CLIENT_ID: string;
	SLACK_CLIENT_SECRET: string;
	HOST: string;
};

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith('/api/slack')) {
			const slackApp = new SlackApp({ env });
			for (const [feature, handler] of Object.entries(features)) {
				if (typeof handler === "function") await handler(slackApp, env);
			}
			return await slackApp.run(request, ctx);
		}

		return createWebApp(env).fetch(request, env, ctx);
	},

	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(syncAllUsers(env.DB, env.SLACK_ADMIN_TOKEN));
		ctx.waitUntil(checkPendingMeetings(env));
	},
};
