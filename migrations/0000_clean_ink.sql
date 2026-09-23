CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_account_unique` ON `account` (`provider`,`providerAccountId`);--> statement-breakpoint
CREATE TABLE `llm_token_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`engine` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`total_tokens` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `log` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE TABLE `playlist` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`length` integer NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`is_exported` integer DEFAULT false NOT NULL,
	`selected_engine` text DEFAULT 'chatgpt' NOT NULL,
	`selected_mood` text DEFAULT '' NOT NULL,
	`selected_track_count` integer DEFAULT 10 NOT NULL,
	`selected_artists` text DEFAULT '[]' NOT NULL,
	`ignored_artists` text DEFAULT '[]' NOT NULL,
	`recommendations` text DEFAULT '[]' NOT NULL,
	`selected_genres` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `playlist_user_id_idx` ON `playlist` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionToken` text NOT NULL,
	`userId` text NOT NULL,
	`expires` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_sessionToken_unique` ON `session` (`sessionToken`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `song` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`order` integer NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`song_id` text,
	`preview_url` text,
	`album_title` text,
	`album_image` text,
	`album_year` integer,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlist`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `song_playlist_id_idx` ON `song` (`playlist_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` text,
	`image` text,
	`role` text DEFAULT 'USER' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification_token` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_token_token_unique` ON `verification_token` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_token_identifier_token_unique` ON `verification_token` (`identifier`,`token`);