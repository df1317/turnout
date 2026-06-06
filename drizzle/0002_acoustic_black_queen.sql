PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attendance` (
	`meeting_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`meeting_id`, `user_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `slack_user`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_attendance`("meeting_id", "user_id", "status", "note") SELECT "meeting_id", "user_id", "status", "note" FROM `attendance`;--> statement-breakpoint
DROP TABLE `attendance`;--> statement-breakpoint
ALTER TABLE `__new_attendance` RENAME TO `attendance`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attendance_user_id_idx` ON `attendance` (`user_id`);--> statement-breakpoint
CREATE INDEX `attendance_meeting_status_idx` ON `attendance` (`meeting_id`,`status`);--> statement-breakpoint
CREATE INDEX `cdt_member_cdt_id_idx` ON `cdt_member` (`cdt_id`);--> statement-breakpoint
CREATE INDEX `meeting_scheduled_cancelled_idx` ON `meeting` (`scheduled_at`,`cancelled`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_channel_id_scheduled_at_unique` ON `meeting` (`channel_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `__new_web_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `slack_user`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_web_session`("id", "user_id", "expires_at") SELECT "id", "user_id", "expires_at" FROM `web_session`;--> statement-breakpoint
DROP TABLE `web_session`;--> statement-breakpoint
ALTER TABLE `__new_web_session` RENAME TO `web_session`;--> statement-breakpoint
CREATE INDEX `web_session_expires_idx` ON `web_session` (`expires_at`);