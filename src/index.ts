import { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers';

function getNewMeetingBlocks(withRepeat: boolean){
	if(!withRepeat){
		return '[{"type":"input","element":{"type":"plain_text_input","action_id":"name"},"label":{"type":"plain_text","text":"Name","emoji":true},"optional":false},{"type":"input","element":{"type":"datetimepicker","action_id":"time"},"label":{"type":"plain_text","text":"Time","emoji":true},"optional":false},{"type":"actions","elements":[{"type":"checkboxes","options":[{"text":{"type":"plain_text","text":":repeat: Repeat","emoji":true},"value":"value-2"}],"action_id":"repeat"}]}]';
	}
	return '[{"type":"input","element":{"type":"plain_text_input","action_id":"name"},"label":{"type":"plain_text","text":"Name","emoji":true},"optional":false},{"type":"input","element":{"type":"datetimepicker","action_id":"time"},"label":{"type":"plain_text","text":"Time","emoji":true},"optional":false},{"type":"actions","elements":[{"type":"checkboxes","options":[{"text":{"type":"plain_text","text":":repeat: Repeat","emoji":true},"value":"value-2"}],"action_id":"repeat"}]},{"type":"input","element":{"type":"datepicker","initial_date":"1990-04-28","placeholder":{"type":"plain_text","text":"Select a date","emoji":true},"action_id":"untilwhen"},"label":{"type":"plain_text","text":"Until when?","emoji":true},"optional":false}]';
}

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
			// console.log("whats context? " +JSON.stringify(context));
			// console.log("whats payload? ",+JSON.stringify(payload));
		  try {

			const client = context.client;

		    const result = await client.views.open({
		      trigger_id: payload.trigger_id,
		      view: {"type":"modal","submit":{"type":"plain_text","text":"Submit","emoji":true},"close":{"type":"plain_text","text":"Cancel","emoji":true},"title":{"type":"plain_text","text":"test view","emoji":true},"blocks":[{"dispatch_action":true,"type":"input","element":{"type":"plain_text_input","action_id":"test_action_id"},"label":{"type":"plain_text","text":"Label","emoji":true},"optional":false}]}
		    });
		    console.log(result);
		  } catch (error) {
		    console.error(error);
		  }
		});

		app.action("test_action_id", async ({payload})=>{
			try {
				console.log("whats action? "+JSON.stringify(payload));
				const textValue = payload.actions[0].value;
				console.log("input value: "+textValue);
			} catch(error){
				console.log(error);
			}
		});


		app.command("/newmeeting",async ({context, payload})=>{
			try {
				const res = await context.client.views.open({
					trigger_id: payload.trigger_id,
					view: {
						"type": "modal",
						"submit": {
							"type": "plain_text",
							"text": "Submit",
							"emoji": true
						},
						"close": {
							"type": "plain_text",
							"text": "Cancel",
							"emoji": true
						},
						"title": {
							"type": "plain_text",
							"text": "test view",
							"emoji": true
						}, blocks: getNewMeetingBlocks(false)
					}
			});
			console.log("res from opeing view:"+JSON.stringify(res));
			} catch (error) {
				console.log(error);
			}
		});

		app.action("repeat", async ({payload, context})=>{
			try {
				console.log("payload: "+JSON.stringify(payload)+" | context: "+JSON.stringify(context));

				const checkboxAction = payload.actions[0] as CheckboxesAction;
				const selectedOptions = checkboxAction.selected_options;

				return {
					response_action: "update",
					view: {
						type: "modal",
						callback_id: payload.view.callback_id,
						title: payload.view.title,
						blocks:[
								{
									"type": "section",
									"text": {
										"type": "plain_text",
										"text": "your view has been updated!",
										"emoji": true
									}
								}
							]
					}
				}

				
			} catch (error) {
				console.log(error);
			}
		});

		return await app.run(request, ctx);
	},
};
