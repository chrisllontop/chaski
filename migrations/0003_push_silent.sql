ALTER TABLE `notifications` ADD `push_silent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduled_notifications` ADD `push_silent` integer DEFAULT false NOT NULL;