const CACHE_KEYS = {
	users: "users_cache",
	cdts: "cdts_cache",
	meetings: "meetings_cache",
	pastMeetings: "past_meetings_cache",
	session: "session_cache",
} as const;

export function getCached<T>(key: string): T | null {
	try {
		const raw = sessionStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export function setCached(key: string, value: unknown): void {
	try {
		sessionStorage.setItem(key, JSON.stringify(value));
	} catch {
		// sessionStorage full or unavailable — silently skip
	}
}

export function invalidateCache(...keys: string[]): void {
	for (const key of keys) {
		sessionStorage.removeItem(key);
	}
}

/** Invalidate all data caches (not session). */
export function invalidateAll(): void {
	invalidateCache(
		CACHE_KEYS.users,
		CACHE_KEYS.cdts,
		CACHE_KEYS.meetings,
		CACHE_KEYS.pastMeetings,
	);
}

export { CACHE_KEYS };
