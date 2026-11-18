CREATE TABLE `app_keys` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_stats` (
	`game_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host_key` text NOT NULL,
	`org_id` text,
	`demo` integer NOT NULL,
	`test` integer NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`first_pick_at` integer,
	`ended_at` integer,
	`last_move_at` integer,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`players` integer DEFAULT 0 NOT NULL,
	`signed_in_players` integer DEFAULT 0 NOT NULL,
	`picks` integer DEFAULT 0 NOT NULL,
	`steals` integer DEFAULT 0 NOT NULL,
	`final_round` integer DEFAULT false NOT NULL,
	`posts` integer DEFAULT 0 NOT NULL,
	`photos` integer DEFAULT 0 NOT NULL,
	`votes` integer DEFAULT 0 NOT NULL,
	`cohosts` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `org_stats` (
	`org_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organizer_key` text NOT NULL,
	`test` integer NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `people_stats` (
	`person_key` text PRIMARY KEY NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ref` text,
	`test` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ref_visits` (
	`day` text NOT NULL,
	`ref` text NOT NULL,
	`visits` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `ref`)
);
--> statement-breakpoint
ALTER TABLE `sign_in_links` ADD `ref` text;