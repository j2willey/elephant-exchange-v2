CREATE TABLE `visitor_days` (
	`day` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitors_seen` (
	`day` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`day`, `fingerprint`)
);
