import type { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import type { Env } from "../index";

const web = (slackApp: SlackApp<SlackEdgeAppEnv>, env: Env) => {
	slackApp.command("/web", async ({ context }) => {
		await context.respond({
			response_type: "ephemeral",
			text: env.HOST,
		});
	});
};

export default web;
