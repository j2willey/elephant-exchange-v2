ALTER TABLE `games` ADD `demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sign_in_links` ADD `feedback_ok` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_sign_in_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `feedback_ok` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Demo games made before the flag existed: "Try a demo game" always named them this.
UPDATE `games` SET `demo` = true WHERE `name` = 'Demo game';