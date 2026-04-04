import { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers';

export default {
	async fetch(request: Request, env: SlackEdgeAppEnv, ctx: ExecutionContext): Promise<Response> {
		const app = new SlackApp({ env }).command(
			'/hello-cf-workers',
			async (req) => {
				// sync handler, which is resposible to ack the request
				return ':wave: This app runs on Cloudflare Workers!';
				// If you don't have anything to do here, the function doesn't need to return anything
				// This means in that case, simply having `async () => {}` works for you
			},
			async ({ context: { respond } }) => {
				// Lazy listener, which can be executed asynchronously
				// You can do whatever may take longer than 3 seconds here
				await respond({ text: 'This is an async reply. How are you doing?' });
			},
		);

		app.command("/test", async (req: Request)=>{
			console.log("test got called! /test has ran and been run!");
			return "/test ran in a cloudflare worker";
		}, async ({context: {response}})=>{
			console.log("/est 'lazy' listner got ran!");
		});

		app.command("/view", async ({ context, payload}) => {
			console.log("whats context? " +JSON.stringify(context));
			console.log("whats payload? ",+JSON.stringify(payload));
		  try {

			const client = context.client;

		    const result = await client.views.open({
		      trigger_id: payload.trigger_id,
		      view: {
		        type: "modal",
		        title: {
		          type: "plain_text",
		          text: "My Modal",
		        },
		        blocks: [
		          {
		            type: "section",
		            text: {
		              type: "mrkdwn",
		              text: "This is a modal",
		            },
		          },
		        ],
		        submit: {
		          type: "plain_text",
		          text: "Submit",
		        },
		      },
		    });
		    console.log(result);
		  } catch (error) {
		    console.error(error);
		  }
		});

		return await app.run(request, ctx);
	},
};
