CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organizer_email` text NOT NULL,
	`color` text,
	`page` text,
	`logo` text,
	`background` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `games` ADD `org_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `games` ADD `theme_color` text;--> statement-breakpoint
ALTER TABLE `games` ADD `theme_page` text;--> statement-breakpoint
ALTER TABLE `games` ADD `theme_logo` text;--> statement-breakpoint
ALTER TABLE `games` ADD `theme_background` text;