CREATE TABLE `daily_counts` (
	`day` text NOT NULL,
	`name` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `name`)
);
--> statement-breakpoint
CREATE TABLE `game_features` (
	`game_id` text NOT NULL,
	`feature` text NOT NULL,
	PRIMARY KEY(`game_id`, `feature`)
);
--> statement-breakpoint
ALTER TABLE `game_stats` ADD `undos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `skips` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `frozen_gifts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `vote_used` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `self_signup` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `peak_screens` integer DEFAULT 0 NOT NULL;