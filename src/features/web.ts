import { drizzle } from "drizzle-orm/d1";
import type { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import { slackTokenLink } from "../db/schema";
import type { Env } from "../index";

const web = (slackApp: SlackApp<SlackEdgeAppEnv>, env: Env) => {
	slackApp.command("/web", async ({ context, ack }) => {
		ack();

		// Get the user ID from the command context
		const userId = context.userId || context.actor?.userId;
		if (!userId) {
			await context.respond({
				response_type: "ephemeral",
				text: "Error: Could not identify user",
			});
			return;
		}

		// Generate a token for this user
		const token = crypto.randomUUID().replace(/-/g, "");
		const now = Math.floor(Date.now() / 1000);
		const expiresAt = now + 24 * 60 * 60; // 24 hour expiration

		// Store the token in the database
		const db = drizzle(env.DB);
		await db
			.insert(slackTokenLink)
			.values({
				token,
				userId,
				createdAt: now,
				expiresAt,
			})
			.run();

		// Build the URL with the token
		const webUrl = `${env.HOST}?token=${token}`;

		await context.respond({
			response_type: "ephemeral",
			text: `<${webUrl}|Open Turnout Dashboard>`,
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `*Turnout Dashboard*\n<${webUrl}|Click here to open the dashboard> - you'll be automatically logged in!`,
					},
				},
				{
					type: "context",
					elements: [
						{
							type: "mrkdwn",
							text: "This link expires in 24 hours",
						},
					],
				},
			],
		});
	});
};

export default web;
