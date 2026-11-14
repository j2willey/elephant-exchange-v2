CREATE TABLE `game_players` (
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`email` text NOT NULL,
	PRIMARY KEY(`game_id`, `player_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_players_person` ON `game_players` (`game_id`,`email`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Gift exchange' NOT NULL,
	`roster_mode` text DEFAULT 'host' NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "games_roster_mode" CHECK("__new_games"."roster_mode" IN ('host', 'self'))
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit copied roster_mode from the old table, which has no such column. Existing Games get the default.
INSERT INTO `__new_games`("id", "name", "settings", "created_at") SELECT "id", "name", "settings", "created_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;