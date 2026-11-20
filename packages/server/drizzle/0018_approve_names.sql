ALTER TABLE `game_names` ADD `pending` text;--> statement-breakpoint
ALTER TABLE `games` ADD `approve_names` integer DEFAULT false NOT NULL;