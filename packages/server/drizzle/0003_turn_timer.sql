CREATE TABLE `turn_clocks` (
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`started_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `player_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `games` ADD `turn_seconds` integer DEFAULT 60 NOT NULL;