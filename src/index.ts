import { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers';
import * as Utils from './Utils.ts';

/*
note: all time is in a unix timestamp unless from slack (then sometimes is yyyy-mm-dd)
Database scema:
	note: yes/maybe/no is a JSON array of the slack userIDs.
	meeting (id INT, time INTEGER, name TEXT, description TEXT, yes TEXT, maybe TEXT, no TEXT)
*/

function getNewMeetingBlocks(withRepeat: boolean){
	if(!withRepeat){
		return `[{"type":"input","element":{"type":"plain_text_input","action_id":"name"},"label":{"type":"plain_text","text":"Name","emoji":true},"optional":false},{"type":"input","element":{"type":"datetimepicker","action_id":"time"},"label":{"type":"plain_text","text":"Time","emoji":true},"optional":false},{"type":"actions","elements":[{"type":"checkboxes","options":[{"text":{"type":"plain_text","text":":repeat: Repeat - once a week until given date","emoji":true},"value":"value-2"}],"action_id":"repeat"}]}]`;
	}
	return `[{"type":"input","element":{"type":"plain_text_input","action_id":"name"},"label":{"type":"plain_text","text":"Name","emoji":true},"optional":false},{"type":"input","element":{"type":"datetimepicker","action_id":"time"},"label":{"type":"plain_text","text":"Time","emoji":true},"optional":false},{"type":"actions","elements":[{"type":"checkboxes","initial_options":[{"value":"value-2","text":{"type":"plain_text","text":":repeat: Repeat - once a week until given date","emoji":true}}],"options":[{"text":{"type":"plain_text","text":":repeat: Repeat - once a week until given date","emoji":true},"value":"value-2"}],"action_id":"repeat"}]},{"type":"input","element":{"type":"datepicker","initial_date":"${Utils.getYYYYMMDD()}","placeholder":{"type":"plain_text","text":"Select a date","emoji":true},"action_id":"untilwhen"},"label":{"type":"plain_text","text":"Until when?","emoji":true},"optional":false}]`;
}

export default {
	async fetch(request: Request, env, ctx: ExecutionContext): Promise<Response> {
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
						callback_id: "new_meeting",
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
							"text": "Create a new meeting!",
							"emoji": true
						}, blocks: getNewMeetingBlocks(false)
					}
			});
			console.log("res from opeing view:"+JSON.stringify(res));
			} catch (error) {
				console.log(error);
			}
		});

		app.viewSubmission("new_meeting", async (req)=>{
			try {
				return {response_action: "clear"};
			} catch (error) {
				console.log(error);
			}
		}, async(req)=>{
			try {
				console.log("LAZY WORKER new_meeting submission req "+JSON.stringify(req));

				const payload = req.payload;

				const view = payload.view;
				const blocks = view.blocks;
				const state = view.state;
				const values = state.values;

				let name: String = '';
				let time: number = -1;
				let repeat = null;
				let untilwhen = null;

				for(const block of blocks){
					const block_id = block.block_id;
					let action_id;
					if(block.type === "input"){
						action_id = block.element.action_id;
					} else {
						action_id = block.elements[0].action_id;
					}
					switch(action_id){
						case 'name':
							name = values[block_id].name.value;
							break;
						case 'time':
							time = values[block_id].time.selected_date_time;
							break;
						case 'repeat':
							repeat = values[block_id].repeat.selected_options.length > 0;
							break;
						case 'untilwhen':
							console.log("until when value: "+JSON.stringify(values[block_id]));
							untilwhen = values[block_id].untilwhen.selected_date;
							break;
					}
				}
				console.log(`name: ${name}, time: ${time}, repeat: ${repeat}, untilwhen: ${untilwhen}`);
				if(repeat && !untilwhen){
					console.log("/newmeeting PARSING broke!");
					return;
				}
				// meeting (id INT, time INTEGER, name TEXT, description TEXT, yes TEXT, maybe TEXT, no TEXT)
				console.log("env.${DB}"+JSON.stringify(env.sirsnap_prod) + " | does it exists? "+ env.sirsnap_prod?true:false);
				env.sirsnap_prod.prepare("INSERT INTO meeting VALUES (1234, ?, ?, '', '[]', '[]', '[]');")
					.bind(time, name)
					.run();

				if(repeat){
					// TODO: add repeat logic
				}
			} catch (error) {
				console.log(error);
			}
		});

		app.action("repeat", async ({payload, context})=>{
			try {
				const actions = payload.actions;
				const checked: boolean = actions[0].selected_options.length > 0;
				
				await Utils.updateModal(payload, getNewMeetingBlocks(checked), env.SLACK_BOT_TOKEN);				
			} catch (error) {
				console.log(error);
			}
		});

		return await app.run(request, ctx);
	},
};
