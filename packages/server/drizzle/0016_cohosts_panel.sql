CREATE TABLE `game_visitors` (
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `email`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `game_hosts` ADD `player_id` text;