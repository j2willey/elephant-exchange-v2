ALTER TABLE `posts` ADD `pitch_for` text;--> statement-breakpoint
CREATE UNIQUE INDEX `posts_pitch_once` ON `posts` (`game_id`,`gift_id`,`pitch_for`);