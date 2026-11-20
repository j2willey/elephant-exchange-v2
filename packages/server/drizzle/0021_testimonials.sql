ALTER TABLE `feedback` ADD `quote_ok` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `quote_name` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `published` integer DEFAULT false NOT NULL;