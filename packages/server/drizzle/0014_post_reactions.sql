CREATE TABLE `post_reactions` (
	`game_id` text NOT NULL,
	`post_id` text NOT NULL,
	`email` text NOT NULL,
	`emoji` text NOT NULL,
	PRIMARY KEY(`post_id`, `email`, `emoji`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_reactions_game` ON `post_reactions` (`game_id`);