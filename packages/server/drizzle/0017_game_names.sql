CREATE TABLE `game_names` (
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`locked` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`game_id`, `email`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
