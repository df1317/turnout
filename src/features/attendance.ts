import { SlackApp, SlackEdgeAppEnv } from "slack-cloudflare-workers";
import type { Env } from "../index";

interface AttendanceRecord {
	userId: string;
	action: "check-in" | "check-out";
	timestamp: number;
}

const attendance = async (slackApp: SlackApp<SlackEdgeAppEnv>, env: Env) => {
	slackApp.command("/attendance", async ({ context, payload }) => {
		if (!context?.respond) return;

		const subcommand = payload.text.trim().split(" ")[0];

		switch (subcommand) {
			case "in":
			case "checkin":
				await handleCheckIn(context);
				break;
			case "out":
			case "checkout":
				await handleCheckOut(context);
				break;
			case "status":
				await handleStatus(context);
				break;
			case "help":
			default:
				await showHelp(context);
				break;
		}
	});

	slackApp.action("attendance-checkin", async ({ context, payload }) => {
		await handleQuickCheckIn(context, payload);
	});

	slackApp.action("attendance-checkout", async ({ context, payload }) => {
		await handleQuickCheckOut(context, payload);
	});
};

async function handleCheckIn(context: any) {
	const now = Date.now();
	const record: AttendanceRecord = {
		userId: context.userId,
		action: "check-in",
		timestamp: now,
	};
	console.log("Check-in record:", record);

	await context.respond({
		response_type: "ephemeral",
		text: "✅ Checked in successfully!",
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `✅ *Welcome to the workspace!*\n\nYou've successfully checked in at <!date^${Math.floor(now / 1000)}^{time_secs}|${new Date(now).toLocaleTimeString()}>`,
				},
			},
			{
				type: "context",
				elements: [
					{
						type: "mrkdwn",
						text: "💡 Use `/attendance out` when you're leaving or click the button below",
					},
				],
			},
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: "Check Out Later" },
						action_id: "attendance-checkout",
						style: "danger",
					},
				],
			},
		],
	});
}

async function handleCheckOut(context: any) {
	const now = Date.now();
	const record: AttendanceRecord = {
		userId: context.userId,
		action: "check-out",
		timestamp: now,
	};
	console.log("Check-out record:", record);

	await context.respond({
		response_type: "ephemeral",
		text: "❌ Checked out successfully!",
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `❌ *Thanks for your time today!*\n\nYou've checked out at <!date^${Math.floor(now / 1000)}^{time_secs}|${new Date(now).toLocaleTimeString()}>`,
				},
			},
			{
				type: "context",
				elements: [
					{
						type: "mrkdwn",
						text: "💡 Use `/attendance in` when you return tomorrow!",
					},
				],
			},
		],
	});
}

async function handleStatus(context: any) {
	await context.respond({
		response_type: "ephemeral",
		text: "📊 Your attendance status",
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: "📊 *Your Attendance Status*\n\n🔍 _Status tracking coming soon!_\n\nFor now, you can check in and out using:\n• `/attendance in` - Check in\n• `/attendance out` - Check out",
				},
			},
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: "Check In ✅" },
						action_id: "attendance-checkin",
						style: "primary",
					},
					{
						type: "button",
						text: { type: "plain_text", text: "Check Out ❌" },
						action_id: "attendance-checkout",
						style: "danger",
					},
				],
			},
		],
	});
}

async function showHelp(context: any) {
	await context.respond({
		response_type: "ephemeral",
		text: "📋 Sirsnap Help - Attendance Tracking",
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: "📋 *Sirsnap Help - Attendance Tracking*",
				},
			},
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: "*Available Commands:*\n• `/attendance in` - Check in\n• `/attendance out` - Check out\n• `/attendance status` - View your status\n• `/attendance help` - Show this help",
				},
			},
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: "Check In ✅" },
						action_id: "attendance-checkin",
						style: "primary",
					},
					{
						type: "button",
						text: { type: "plain_text", text: "Check Out ❌" },
						action_id: "attendance-checkout",
						style: "danger",
					},
				],
			},
		],
	});
}

async function handleQuickCheckIn(context: any, action: any) {
	const now = Date.now();
	console.log("Quick check-in:", { userId: action.user.id, timestamp: now });

	await context.respond({
		response_type: "ephemeral",
		text: "✅ Quick check-in successful!",
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `✅ *Quick Check-In Complete!*\n\nWelcome back, <@${action.user.id}>!\n\n_Checked in at: <!date^${Math.floor(now / 1000)}^{time_secs}|${new Date(now).toLocaleTimeString()}>_`,
				},
			},
		],
	});
}

async function handleQuickCheckOut(context: any, action: any) {
	const now = Date.now();
	console.log("Quick check-out:", { userId: action.user.id, timestamp: now });

	await context.respond({
		response_type: "ephemeral",
		text: "❌ Quick check-out successful!",
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `❌ *Quick Check-Out Complete!*\n\nThanks for your time, <@${action.user.id}>!\n\n_Checked out at: <!date^${Math.floor(now / 1000)}^{time_secs}|${new Date(now).toLocaleTimeString()}>_`,
				},
			},
		],
	});
}

export default attendance;
