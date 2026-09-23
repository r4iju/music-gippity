CREATE TABLE `generation_checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`phase` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`attempt` text NOT NULL,
	`paid` integer NOT NULL,
	`deadline` integer NOT NULL,
	`completed_at` integer,
	`output` text,
	FOREIGN KEY (`run_id`) REFERENCES `generation_run`(`id`) ON UPDATE no action ON DELETE no action
);
