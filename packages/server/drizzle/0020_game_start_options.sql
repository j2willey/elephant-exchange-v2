ALTER TABLE `game_stats` ADD `start_choice` text;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `looked_at_options` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `options_at_start` text;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `options` text;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `turns` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `turn_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_stats` ADD `turns_over_timer` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `my_options` text;--> statement-breakpoint
ALTER TABLE `users` ADD `always_my_options` integer DEFAULT false NOT NULL;