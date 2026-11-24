CREATE TABLE `invitations` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`sent_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invitations_person` ON `invitations` (`game_id`,`email`);--> statement-breakpoint
CREATE INDEX `invitations_sent_at` ON `invitations` (`sent_at`);