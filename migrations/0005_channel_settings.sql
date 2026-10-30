CREATE TABLE `settings` (
	`section` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`secret` text,
	`updated_by_id` text NOT NULL,
	`updated_by_name` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
