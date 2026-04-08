CREATE TABLE `attendance` (
	`meeting_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cdt` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`handle` text NOT NULL,
	`channel_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cdt_name_unique` ON `cdt` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `cdt_handle_unique` ON `cdt` (`handle`);--> statement-breakpoint
CREATE TABLE `cdt_member` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cdt_id` text NOT NULL,
	FOREIGN KEY (`cdt_id`) REFERENCES `cdt`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kv_store` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meeting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scheduled_at` integer NOT NULL,
	`end_time` integer,
	`channel_id` text NOT NULL,
	`message_ts` text NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `meeting_series`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `meeting_series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`days_of_week` text NOT NULL,
	`time_of_day` integer NOT NULL,
	`end_date` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_announcement` (
	`meeting_id` integer PRIMARY KEY NOT NULL,
	`queued_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `slack_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_user` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`role` text,
	`last_synced` integer DEFAULT 0 NOT NULL,
	`calendar_token` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_user_calendar_token_unique` ON `slack_user` (`calendar_token`);--> statement-breakpoint
CREATE TABLE `web_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
