CREATE TABLE `playlist_generation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`worker_id` text,
	`dispatch_until` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `playlist_generation_user_created_idx` ON `playlist_generation` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `account` ADD `refresh_lease_until` integer DEFAULT 0 NOT NULL;