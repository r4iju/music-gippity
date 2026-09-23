CREATE TABLE `generation_run` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`user_id` text NOT NULL,
	`request_key` text NOT NULL,
	`state` text NOT NULL,
	`worker_id` text,
	`dispatch_until` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`deadline` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlist_draft`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_run_playlist_id_unique` ON `generation_run` (`playlist_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_run_owner_request_unique` ON `generation_run` (`user_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `playlist_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contents` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `playlist_draft_user_created_idx` ON `playlist_draft` (`user_id`,`created_at`);