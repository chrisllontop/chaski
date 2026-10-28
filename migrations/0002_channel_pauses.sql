CREATE TABLE `channel_pauses` (
	`channel` text PRIMARY KEY NOT NULL,
	`paused_by_id` text NOT NULL,
	`paused_by_name` text,
	`paused_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
