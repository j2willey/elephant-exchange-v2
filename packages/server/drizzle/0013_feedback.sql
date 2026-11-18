CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`game_id` text,
	`person_key` text NOT NULL,
	`rating` integer,
	`again` text,
	`thumbs` text,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "feedback_kind" CHECK("feedback"."kind" IN ('host', 'guest', 'suggestion')),
	CONSTRAINT "feedback_rating" CHECK("feedback"."rating" IS NULL OR "feedback"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_once` ON `feedback` (`kind`,`game_id`,`person_key`);--> statement-breakpoint
CREATE TABLE `feedback_emails` (
	`game_id` text PRIMARY KEY NOT NULL,
	`sent_at` integer NOT NULL
);
