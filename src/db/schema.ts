import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	unique,
} from "drizzle-orm/sqlite-core";

export const cdt = sqliteTable("cdt", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	handle: text("handle").notNull().unique(),
	channelId: text("channel_id").notNull(),
});

export const cdtMember = sqliteTable(
	"cdt_member",
	{
		userId: text("user_id").primaryKey(),
		cdtId: text("cdt_id")
			.notNull()
			.references(() => cdt.id, { onDelete: "cascade" }),
	},
	(table) => ({
		cdtIdIdx: index("cdt_member_cdt_id_idx").on(table.cdtId),
	}),
);

export const meetingSeries = sqliteTable("meeting_series", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	daysOfWeek: text("days_of_week").notNull(),
	timeOfDay: integer("time_of_day").notNull(),
	endDate: integer("end_date").notNull(),
});

export const meeting = sqliteTable(
	"meeting",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		seriesId: integer("series_id").references(() => meetingSeries.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		scheduledAt: integer("scheduled_at").notNull(),
		endTime: integer("end_time"),
		channelId: text("channel_id").notNull(),
		messageTs: text("message_ts").notNull(),
		cancelled: integer("cancelled").notNull().default(0),
	},
	(table) => ({
		channelScheduledUniq: unique().on(table.channelId, table.scheduledAt),
		scheduledCancelledIdx: index("meeting_scheduled_cancelled_idx").on(
			table.scheduledAt,
			table.cancelled,
		),
	}),
);

export const slackUser = sqliteTable("slack_user", {
	userId: text("user_id").primaryKey(),
	name: text("name").notNull().default(""),
	avatarUrl: text("avatar_url").notNull().default(""),
	isAdmin: integer("is_admin").notNull().default(0),
	role: text("role", { enum: ["student", "parent", "alumni", "mentor"] }),
	lastSynced: integer("last_synced").notNull().default(0),
	calendarToken: text("calendar_token").unique(),
});

export const attendance = sqliteTable(
	"attendance",
	{
		meetingId: integer("meeting_id")
			.notNull()
			.references(() => meeting.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => slackUser.userId, { onDelete: "cascade" }),
		status: text("status", { enum: ["yes", "maybe", "no"] }).notNull(),
		note: text("note").notNull().default(""),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.meetingId, table.userId] }),
		userIdIdx: index("attendance_user_id_idx").on(table.userId),
		meetingStatusIdx: index("attendance_meeting_status_idx").on(
			table.meetingId,
			table.status,
		),
	}),
);

export const webSession = sqliteTable(
	"web_session",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => slackUser.userId, { onDelete: "cascade" }),
		expiresAt: integer("expires_at").notNull(),
	},
	(table) => ({
		expiresIdx: index("web_session_expires_idx").on(table.expiresAt),
	}),
);

export const kvStore = sqliteTable("kv_store", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

export const slackCache = sqliteTable("slack_cache", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	expiresAt: integer("expires_at").notNull(),
});

export const pendingAnnouncement = sqliteTable("pending_announcement", {
	meetingId: integer("meeting_id")
		.primaryKey()
		.references(() => meeting.id, { onDelete: "cascade" }),
	queuedAt: integer("queued_at").notNull(),
});
