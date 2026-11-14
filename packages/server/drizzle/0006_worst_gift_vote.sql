CREATE TABLE `votes` (
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`gift_id` text NOT NULL,
	PRIMARY KEY(`game_id`, `email`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Gift exchange' NOT NULL,
	`roster_mode` text DEFAULT 'host' NOT NULL,
	`moderation` text DEFAULT 'open' NOT NULL,
	`turn_seconds` integer DEFAULT 60 NOT NULL,
	`vote_status` text DEFAULT 'none' NOT NULL,
	`vote_display` text DEFAULT 'live' NOT NULL,
	`vote_winner` text,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "games_roster_mode" CHECK("__new_games"."roster_mode" IN ('host', 'self')),
	CONSTRAINT "games_moderation" CHECK("__new_games"."moderation" IN ('open', 'approval', 'paused')),
	CONSTRAINT "games_vote_status" CHECK("__new_games"."vote_status" IN ('none', 'open', 'closed')),
	CONSTRAINT "games_vote_display" CHECK("__new_games"."vote_display" IN ('live', 'hidden', 'parade'))
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit's generated INSERT also copied vote_status, vote_display and vote_winner, which the
-- old table doesn't have (the same drizzle-kit bug as 0002 and 0004). The new columns take their defaults.
INSERT INTO `__new_games`("id", "name", "roster_mode", "moderation", "turn_seconds", "settings", "created_at") SELECT "id", "name", "roster_mode", "moderation", "turn_seconds", "settings", "created_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;