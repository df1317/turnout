export type Session = {
	user_id: string;
	name: string;
	avatar_url: string;
	is_admin: boolean;
	role: string | null;
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

async function apiFetch(path: string, init?: RequestInit) {
	const res = await fetch(path, { credentials: "include", ...init });
	if (res.status === 401) {
		window.location.href = "/login";
		throw new Error("Unauthorized");
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
	async getMeetings(): Promise<Meeting[]> {
		return (await apiFetch("/api/meetings")).json();
	},
	async getCdts(): Promise<Cdt[]> {
		return (await apiFetch("/api/cdts")).json();
	},
	async rsvp(
		meetingId: number,
		status: "yes" | "maybe" | "no",
		note = "",
	): Promise<void> {
		await apiFetch(`/api/rsvp/${meetingId}`, {
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
		data: { name?: string; channel_id?: string },
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
	async deleteMeeting(id: number): Promise<void> {
		await apiFetch(`/api/admin/meetings/${id}`, { method: "DELETE" });
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
