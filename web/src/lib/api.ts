export type Session = {
	user_id: string;
	name: string;
	avatar_url: string;
	is_admin: boolean;
	role: string | null;
	calendar_token: string | null;
};

export type User = {
	user_id: string;
	name: string;
	avatar_url: string;
	role: string | null;
	is_admin: boolean;
	cdt_id: string | null;
	cdt_name: string | null;
};

export type Meeting = {
	id: number;
	name: string;
	description: string;
	scheduled_at: number;
	end_time: number | null;
	my_status: "yes" | "maybe" | "no" | null;
	my_note: string | null;
	yes_count: number;
	maybe_count: number;
	no_count: number;
};

export type MeetingAttendance = {
	user_id: string;
	status: string;
	note: string;
	name: string;
	avatar_url: string;
};

export type AdminMeeting = {
	id: number;
	name: string;
	description: string;
	scheduled_at: number;
	end_time: number | null;
	channel_id: string;
	cancelled: boolean;
	series_id: number | null;
	yes_count: number;
	maybe_count: number;
	no_count: number;
};

export type Cdt = {
	id: string;
	name: string;
	handle: string;
	channel_id: string;
	member_count: number;
};

export type CdtDetail = Cdt & {
	members: { user_id: string; name: string; avatar_url: string }[];
};

export type UserMeeting = {
	id: number;
	name: string;
	scheduled_at: number;
	end_time: number | null;
	status: "yes" | "maybe" | "no";
	note: string;
};

export interface SystemStats {
	users: number;
	meetings: number;
	pastMeetings: number;
	pendingAnnouncements: number;
	cdts: number;
	attendance: number;
}

async function apiFetch(path: string, init?: RequestInit) {
	const res = await fetch(path, { credentials: "include", ...init });
	if (res.status === 401) {
		throw new Error("Unauthorized");
	}
	if (!res.ok) {
		const text = await res.text();
		try {
			const data = JSON.parse(text);
			throw new Error(data.error || `HTTP error ${res.status}`);
		} catch (e) {
			if (
				e instanceof Error &&
				e.message !== "Unexpected end of JSON input" &&
				!e.message.includes("is not valid JSON")
			) {
				throw e;
			}
			throw new Error(text || `HTTP error ${res.status}`);
		}
	}
	return res;
}

export const api = {
	async getMe(): Promise<Session> {
		const r = await apiFetch("/api/me");
		if (!r.ok) throw new Error("Not authenticated");
		return r.json();
	},
	async getUsers(): Promise<User[]> {
		return (await apiFetch("/api/users")).json();
	},
	async getMeeting(id: number, token?: string): Promise<Meeting> {
		return (
			await apiFetch(`/api/meetings/${id}${token ? `/${token}` : ""}`)
		).json();
	},
	async getMeetings(): Promise<Meeting[]> {
		return (await apiFetch("/api/meetings")).json();
	},
	async getPastMeetings(): Promise<Meeting[]> {
		return (await apiFetch("/api/meetings/past")).json();
	},
	async getCdts(): Promise<Cdt[]> {
		return (await apiFetch("/api/cdts")).json();
	},
	async rsvp(
		meetingId: number,
		status: "yes" | "maybe" | "no",
		note = "",
		token?: string,
	): Promise<void> {
		await apiFetch(`/api/rsvp/${meetingId}${token ? `/${token}` : ""}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status, note }),
		});
	},
	async setRole(userId: string, role: string | null): Promise<void> {
		await apiFetch(`/api/admin/users/${userId}/role`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ role }),
		});
	},
	async syncUsers(): Promise<void> {
		await apiFetch("/api/admin/sync", { method: "POST" });
	},
	async queueAnnouncements(): Promise<{ count: number }> {
		return (
			await apiFetch("/api/admin/queue-announcements", { method: "POST" })
		).json();
	},
	async getStats(): Promise<SystemStats> {
		return (await apiFetch("/api/admin/stats")).json();
	},

	// Admin user APIs
	async setUserCdt(userId: string, cdtId: string | null): Promise<void> {
		await apiFetch(`/api/admin/users/${userId}/cdt`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cdt_id: cdtId }),
		});
	},
	async getUserMeetings(userId: string): Promise<UserMeeting[]> {
		return (await apiFetch(`/api/admin/users/${userId}/meetings`)).json();
	},

	// Admin CDT APIs
	async getAdminCdts(): Promise<Cdt[]> {
		return (await apiFetch("/api/admin/cdts")).json();
	},
	async getCdt(id: string): Promise<CdtDetail> {
		return (await apiFetch(`/api/admin/cdts/${id}`)).json();
	},
	async createCdt(data: {
		name: string;
		handle?: string;
		channel_id?: string;
	}): Promise<Cdt> {
		return (
			await apiFetch("/api/admin/cdts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			})
		).json();
	},
	async updateCdt(
		id: string,
		data: { name?: string; channel_id?: string; members?: string[] },
	): Promise<void> {
		await apiFetch(`/api/admin/cdts/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});
	},
	async deleteCdt(id: string): Promise<void> {
		await apiFetch(`/api/admin/cdts/${id}`, { method: "DELETE" });
	},

	// Meeting Admin APIs
	async getAdminMeetings(): Promise<AdminMeeting[]> {
		return (await apiFetch("/api/admin/meetings")).json();
	},
	async getMeetingAttendance(id: number): Promise<MeetingAttendance[]> {
		return (await apiFetch(`/api/admin/meetings/${id}/attendance`)).json();
	},
	async createMeeting(data: {
		name: string;
		description?: string;
		scheduled_at: number;
		end_time?: number;
		channel_id?: string;
	}): Promise<AdminMeeting> {
		return (
			await apiFetch("/api/admin/meetings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			})
		).json();
	},
	async createMeetingSeries(data: {
		name: string;
		description?: string;
		scheduled_at: number;
		duration_minutes?: number;
		channel_id?: string;
		days_of_week: number[];
		time_of_day_minutes: number;
		end_date: number;
	}): Promise<AdminMeeting> {
		return (
			await apiFetch("/api/admin/meetings/series", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			})
		).json();
	},
	async updateMeeting(
		id: number,
		data: {
			name?: string;
			description?: string;
			scheduled_at?: number;
			end_time?: number | null;
		},
	): Promise<void> {
		await apiFetch(`/api/admin/meetings/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});
	},
	async cancelMeeting(id: number, cancelled: boolean): Promise<void> {
		await apiFetch(`/api/admin/meetings/${id}/cancel`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cancelled }),
		});
	},
	async importIcs(
		url: string,
		channel_id?: string,
	): Promise<{ ok: boolean; count: number }> {
		return (
			await apiFetch("/api/admin/meetings/import-ics", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url, channel_id }),
			})
		).json();
	},
	async deleteMeeting(id: number): Promise<void> {
		await apiFetch(`/api/admin/meetings/${id}`, { method: "DELETE" });
	},

	// Settings
	async getSetting(key: string): Promise<string | null> {
		const res = await apiFetch(`/api/admin/settings/${key}`);
		const json = await res.json();
		return json.value;
	},
	async setSetting(key: string, value: string): Promise<void> {
		await apiFetch(`/api/admin/settings/${key}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ value }),
		});
	},

	// Slack channels
	async getSlackChannels(): Promise<
		{ id: string; name: string; is_private: boolean }[]
	> {
		return (await apiFetch("/api/admin/slack/channels")).json();
	},

	// Bulk user APIs
	async bulkSetRole(userIds: string[], role: string | null): Promise<void> {
		await apiFetch("/api/admin/users/bulk/role", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ user_ids: userIds, role }),
		});
	},
	async bulkSetCdt(userIds: string[], cdtId: string | null): Promise<void> {
		await apiFetch("/api/admin/users/bulk/cdt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ user_ids: userIds, cdt_id: cdtId }),
		});
	},
};
