ALTER TABLE `notifications` ADD `push_collapse_id` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `data` text;--> statement-breakpoint
ALTER TABLE `scheduled_notifications` ADD `push_collapse_id` text;--> statement-breakpoint
ALTER TABLE `scheduled_notifications` ADD `data` text;