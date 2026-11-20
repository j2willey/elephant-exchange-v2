PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Gift exchange' NOT NULL,
	`tagline` text DEFAULT '' NOT NULL,
	`roster_mode` text DEFAULT 'host' NOT NULL,
	`moderation` text DEFAULT 'open' NOT NULL,
	`approve_names` integer DEFAULT false NOT NULL,
	`turn_seconds` integer DEFAULT 60 NOT NULL,
	`posts_per_minute` integer DEFAULT 3 NOT NULL,
	`repitch_minutes` integer DEFAULT 5 NOT NULL,
	`vote_status` text DEFAULT 'none' NOT NULL,
	`vote_display` text DEFAULT 'live' NOT NULL,
	`vote_winner` text,
	`screen_mode` text DEFAULT 'gifts' NOT NULL,
	`org_id` text,
	`theme_color` text,
	`theme_page` text,
	`theme_logo` text,
	`theme_background` text,
	`demo` integer DEFAULT false NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "games_roster_mode" CHECK("__new_games"."roster_mode" IN ('host', 'self')),
	CONSTRAINT "games_moderation" CHECK("__new_games"."moderation" IN ('open', 'approval', 'paused')),
	CONSTRAINT "games_vote_status" CHECK("__new_games"."vote_status" IN ('none', 'open', 'closed')),
	CONSTRAINT "games_vote_display" CHECK("__new_games"."vote_display" IN ('live', 'hidden', 'parade')),
	CONSTRAINT "games_screen_mode" CHECK("__new_games"."screen_mode" IN ('gifts', 'rules', 'qr', 'catalog', 'highlights'))
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "name", "tagline", "roster_mode", "moderation", "approve_names", "turn_seconds", "posts_per_minute", "repitch_minutes", "vote_status", "vote_display", "vote_winner", "screen_mode", "org_id", "theme_color", "theme_page", "theme_logo", "theme_background", "demo", "settings", "created_at") SELECT "id", "name", "tagline", "roster_mode", "moderation", "approve_names", "turn_seconds", "posts_per_minute", "repitch_minutes", "vote_status", "vote_display", "vote_winner", "screen_mode", "org_id", "theme_color", "theme_page", "theme_logo", "theme_background", "demo", "settings", "created_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;