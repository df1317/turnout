import { slackApp } from "../index";

const hello = async () => {
  slackApp.command("/hello", async ({ context, payload }) => {
    console.log("/hello just got called from hello.ts!");
    if (!context?.respond) return;

    await context.respond({
      response_type: "ephemeral",
      text: "Hello there! I'm Sirsnap 👋",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Hello <@${context.userId}>! 👋\n\nI'm Sirsnap, your attendance tracking bot for Team 1317 Digital Fusion!`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Check In ✅",
              },
              action_id: "check-in",
              style: "primary",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Check Out ❌",
              },
              action_id: "check-out",
              style: "danger",
            },
          ],
        },
      ],
    });
  });

  slackApp.action("check-in", async ({ context, action }) => {
    if (!context?.respond) return;

    await context.respond({
      response_type: "ephemeral",
      text: `✅ You've checked in! Welcome to the workspace, <@${action.user.id}>!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *Checked In!*\n\nWelcome to the workspace, <@${action.user.id}>! Your attendance has been recorded.\n\n_Time: <!date^${Math.floor(Date.now() / 1000)}^{time}|now>_`,
          },
        },
      ],
    });
  });

  slackApp.action("check-out", async ({ context, action }) => {
    if (!context?.respond) return;

    await context.respond({
      response_type: "ephemeral",
      text: `❌ You've checked out! See you later, <@${action.user.id}>!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `❌ *Checked Out!*\n\nSee you later, <@${action.user.id}>! Thanks for your time today.\n\n_Time: <!date^${Math.floor(Date.now() / 1000)}^{time}|now>_`,
          },
        },
      ],
    });
  });
};

export default hello;