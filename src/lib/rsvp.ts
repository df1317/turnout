import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

// biome-ignore lint/suspicious/noExplicitAny: routes call drizzle(c.env.DB) without schema param
type AnyDb = DrizzleD1Database<any>;

type RsvpStatus = "yes" | "maybe" | "no";

const VALID_STATUSES: readonly string[] = ["yes", "maybe", "no"];

export function isValidRsvpStatus(status: string): status is RsvpStatus {
	return VALID_STATUSES.includes(status);
}

/**
 * Record an RSVP for a meeting. Handles both insert and update,
 * and queues a pending announcement.
 */
export async function recordRsvp(
	db: AnyDb,
	meetingId: number,
	userId: string,
	status: RsvpStatus,
	note: string,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);

	await db
		.insert(schema.attendance)
		.values({ meetingId, userId, status, note })
		.onConflictDoUpdate({
			target: [schema.attendance.meetingId, schema.attendance.userId],
			set: { status, note },
		});

	await db
		.insert(schema.pendingAnnouncement)
		.values({ meetingId, queuedAt: now })
		.onConflictDoUpdate({
			target: schema.pendingAnnouncement.meetingId,
			set: { queuedAt: now },
		});
}
