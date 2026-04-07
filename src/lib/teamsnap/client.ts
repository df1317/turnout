import type { TeamSnapCollection } from "./types";

export class TeamSnapClient {
	private token: string;
	private teamId: string;

	constructor(token: string, teamId: string) {
		this.token = token;
		this.teamId = teamId;
	}

	private async fetchAPI<T = TeamSnapCollection>(
		path: string,
		options: RequestInit = {},
	): Promise<T> {
		const url = `https://api.teamsnap.com${path}`;
		console.log(`[TeamSnap] Fetching: ${url}`);

		const response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: "application/vnd.collection+json",
				...options.headers,
			},
		});

		const text = await response.text();
		console.log(`[TeamSnap] Response status: ${response.status}`);
		console.log(`[TeamSnap] Response body snippet: ${text.substring(0, 500)}`);

		if (!response.ok) {
			throw new Error(
				`TeamSnap API error: ${response.status} ${response.statusText} - ${text}`,
			);
		}

		return JSON.parse(text);
	}

	async getAvailabilities(teamId: string = this.teamId) {
		return this.fetchAPI(`/v3/availabilities/search?team_id=${teamId}`);
	}

	async getBulkLoad(teamId: string = this.teamId) {
		return this.fetchAPI(`/v3/bulk_load?team_id=${teamId}&types=event,member`);
	}
}
