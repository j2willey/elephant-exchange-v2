CREATE TABLE `game_events` (
	`game_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `seq`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `game_hosts` (
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`game_id`, `email`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_hosts_role" CHECK("game_hosts"."role" IN ('host', 'cohost'))
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sign_in_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`requested_at` integer NOT NULL,
	`client_ip` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `sign_in_links_requested_at` ON `sign_in_links` (`requested_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);