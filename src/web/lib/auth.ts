import type { Env } from "../../index";

const SCOPES = "identity.basic,identity.avatar";

export function buildOAuthUrl(env: Env, state: string): string {
	const params = new URLSearchParams({
		client_id: env.SLACK_CLIENT_ID,
		user_scope: SCOPES,
		redirect_uri: getRedirectUri(env),
		state,
	});
	if (env.SLACK_TEAM_ID) {
		params.set("team", env.SLACK_TEAM_ID);
	}
	return `https://slack.com/oauth/v2/authorize?${params}`;
}

function getRedirectUri(env: Env): string {
	return `${env.HOST}/auth/callback`;
}

export async function exchangeCode(
	env: Env,
	code: string,
): Promise<{
	userId: string;
	name: string;
	avatarUrl: string;
	accessToken: string;
	teamId: string;
}> {
	const res = await fetch("https://slack.com/api/oauth.v2.access", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.SLACK_CLIENT_ID,
			client_secret: env.SLACK_CLIENT_SECRET,
			code,
			redirect_uri: getRedirectUri(env),
		}),
	});
	// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	const data: any = await res.json();
	if (!data.ok) throw new Error(`oauth.v2.access failed: ${data.error}`);

	const authedUser = data.authed_user;
	const userToken: string = authedUser.access_token;
	const teamId: string = data.team?.id;

	const identity = (await fetch("https://slack.com/api/users.identity", {
		headers: { Authorization: `Bearer ${userToken}` },
		// biome-ignore lint/suspicious/noExplicitAny: need to use any here for now
	}).then((r) => r.json())) as any;
	if (!identity.ok) throw new Error(`users.identity failed: ${identity.error}`);

	return {
		userId: identity.user.id,
		name: identity.user.name,
		avatarUrl: identity.user.image_72 ?? "",
		accessToken: userToken,
		teamId,
	};
}
