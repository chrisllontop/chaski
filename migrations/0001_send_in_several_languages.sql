CREATE TABLE `template_translations` (
	`template_channel_id` text NOT NULL,
	`locale` text NOT NULL,
	`subject` text,
	`body` text NOT NULL,
	`text_body` text,
	`source_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`template_channel_id`, `locale`),
	FOREIGN KEY (`template_channel_id`) REFERENCES `template_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `deliveries` ADD `rendered_locale` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `requested_locale` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `requested_locale_from` text;--> statement-breakpoint
ALTER TABLE `scheduled_notifications` ADD `requested_locale` text;--> statement-breakpoint
ALTER TABLE `scheduled_notifications` ADD `requested_locale_from` text;