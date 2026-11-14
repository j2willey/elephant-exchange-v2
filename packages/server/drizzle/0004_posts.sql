CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`author` text NOT NULL,
	`gift_id` text,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "posts_status" CHECK("posts"."status" IN ('visible', 'pending', 'hidden'))
);
--> statement-breakpoint
CREATE INDEX `posts_game` ON `posts` (`game_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Gift exchange' NOT NULL,
	`roster_mode` text DEFAULT 'host' NOT NULL,
	`moderation` text DEFAULT 'open' NOT NULL,
	`turn_seconds` integer DEFAULT 60 NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "games_roster_mode" CHECK("__new_games"."roster_mode" IN ('host', 'self')),
	CONSTRAINT "games_moderation" CHECK("__new_games"."moderation" IN ('open', 'approval', 'paused'))
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit copied moderation from the old table, which has no such column. Existing Games get the default.
INSERT INTO `__new_games`("id", "name", "roster_mode", "turn_seconds", "settings", "created_at") SELECT "id", "name", "roster_mode", "turn_seconds", "settings", "created_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;