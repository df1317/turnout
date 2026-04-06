import { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import * as features from "./features/index";

export type Env = SlackEdgeAppEnv & { DB: D1Database; SLACK_ADMIN_TOKEN: string };

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const slackApp = new SlackApp({ env });

		for (const [feature, handler] of Object.entries(features)) {
			console.log(`loading feature: ${feature}`);
			if (typeof handler === "function") await handler(slackApp, env);
		}

		return await slackApp.run(request, ctx);
	},
};
