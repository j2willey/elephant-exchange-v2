ALTER TABLE `games` ADD `posts_per_minute` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `repitch_minutes` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `tagline` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `bumped_at` integer;