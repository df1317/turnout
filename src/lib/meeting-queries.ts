import {
	and,
	asc,
	desc,
	sql as drizzleSql,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	or,
	type SQL,
} from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

// biome-ignore lint/suspicious/noExplicitAny: routes call drizzle(c.env.DB) without schema param
type AnyDb = DrizzleD1Database<any>;

/** Shape returned by selectMeetingWithCounts */
export interface MeetingWithCounts {
	id: number;
	name: string;
	description: string;
	scheduled_at: number;
	end_time: number | null;
	my_status: string | null;
	my_note: string | null;
	yes_count: number;
	maybe_count: number;
	no_count: number;
}

const MEETING_COUNTS_SELECT = {
	id: schema.meeting.id,
	name: schema.meeting.name,
	description: schema.meeting.description,
	scheduled_at: schema.meeting.scheduledAt,
	end_time: schema.meeting.endTime,
	my_status: schema.attendance.status,
	my_note: schema.attendance.note,
	yes_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'yes')`,
	maybe_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'maybe')`,
	no_count: drizzleSql<number>`(SELECT COUNT(*) FROM attendance WHERE meeting_id = ${schema.meeting.id} AND status = 'no')`,
};

function normalizeCounts(r: MeetingWithCounts): MeetingWithCounts {
	return {
		...r,
		yes_count: Number(r.yes_count || 0),
		maybe_count: Number(r.maybe_count || 0),
		no_count: Number(r.no_count || 0),
	};
}

/** Filter for upcoming (non-cancelled) meetings visible to a user. */
export function upcomingMeetingFilter(now: number, userId?: string) {
	const conditions = [
		eq(schema.meeting.cancelled, 0),
		or(
			gt(schema.meeting.scheduledAt, now),
			and(isNotNull(schema.meeting.endTime), gt(schema.meeting.endTime, now)),
			and(
				isNull(schema.meeting.endTime),
				lte(schema.meeting.scheduledAt, now),
				drizzleSql`${schema.meeting.scheduledAt} + (3 * 60 * 60) > ${now}`,
			),
		),
	];
	return and(...conditions);
}

/** Filter for past (non-cancelled) meetings. */
export function pastMeetingFilter(now: number) {
	return and(
		eq(schema.meeting.cancelled, 0),
		or(
			and(isNotNull(schema.meeting.endTime), lte(schema.meeting.endTime, now)),
			and(
				isNull(schema.meeting.endTime),
				drizzleSql`${schema.meeting.scheduledAt} + (3 * 60 * 60) <= ${now}`,
			),
		),
	);
}

/**
 * Select meetings with RSVP counts, optionally filtered by a specific user's attendance.
 * Replaces the duplicated query blocks across meetings and admin-meetings routes.
 */
export async function selectMeetingsWithCounts(
	db: AnyDb,
	opts: {
		where?: SQL;
		userId?: string;
		orderBy?: "asc" | "desc";
		limit?: number;
		offset?: number;
	},
): Promise<MeetingWithCounts[]> {
	const joinCondition = opts.userId
		? and(
				eq(schema.attendance.meetingId, schema.meeting.id),
				eq(schema.attendance.userId, opts.userId),
			)
		: eq(schema.attendance.meetingId, schema.meeting.id);

	let query = db
		.select(MEETING_COUNTS_SELECT)
		.from(schema.meeting)
		.leftJoin(schema.attendance, joinCondition);

	if (opts.where) {
		query = query.where(opts.where) as typeof query;
	}

	if (opts.orderBy === "desc") {
		query = query.orderBy(desc(schema.meeting.scheduledAt)) as typeof query;
	} else {
		query = query.orderBy(asc(schema.meeting.scheduledAt)) as typeof query;
	}

	if (opts.limit !== undefined) {
		query = query.limit(opts.limit) as typeof query;
	}
	if (opts.offset !== undefined) {
		query = query.offset(opts.offset) as typeof query;
	}

	const rows = await query.all();
	return rows.map(normalizeCounts);
}

/**
 * Select a single meeting by ID with RSVP counts for a specific user.
 */
export async function selectMeetingByIdWithCounts(
	db: AnyDb,
	meetingId: number,
	userId: string,
): Promise<MeetingWithCounts | null> {
	const row = await db
		.select(MEETING_COUNTS_SELECT)
		.from(schema.meeting)
		.leftJoin(
			schema.attendance,
			and(
				eq(schema.attendance.meetingId, schema.meeting.id),
				eq(schema.attendance.userId, userId),
			),
		)
		.where(eq(schema.meeting.id, meetingId))
		.get();

	return row ? normalizeCounts(row) : null;
}
