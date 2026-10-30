CREATE TABLE `channel_pauses` (
	`channel` text PRIMARY KEY NOT NULL,
	`paused_by_id` text NOT NULL,
	`paused_by_name` text,
	`paused_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`section` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`secret` text,
	`updated_by_id` text NOT NULL,
	`updated_by_name` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`recipient_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text,
	`phone_e164` text,
	`timezone` text,
	`locale` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`platform` text NOT NULL,
	`token` text NOT NULL,
	`meta` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_device_tokens_token` ON `device_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_device_tokens_recipient` ON `device_tokens` (`recipient_id`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`recipient_id` text PRIMARY KEY NOT NULL,
	`channels` text NOT NULL,
	`muted_types` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`skip_reason` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`error_code` text,
	`provider_message_id` text,
	`sent_at` integer,
	`provider_ms` integer,
	`opened_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_deliveries_channel` ON `deliveries` (`notification_id`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_deliveries_status` ON `deliveries` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_deliveries_updated` ON `deliveries` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_deliveries_opened` ON `deliveries` (`opened_at`) WHERE opened_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_deliveries_sent` ON `deliveries` (`sent_at`) WHERE sent_at IS NOT NULL;--> statement-breakpoint
CREATE TABLE `feed_items` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`data` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_feed_recipient` ON `feed_items` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_feed_unread` ON `feed_items` (`recipient_id`,`created_at`) WHERE read_at IS NULL;--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`contact_snapshot` text NOT NULL,
	`attachments` text,
	`email_overrides` text,
	`push_silent` integer DEFAULT false NOT NULL,
	`push_collapse_id` text,
	`data` text,
	`transactional` integer DEFAULT false NOT NULL,
	`idempotency_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notifications_idempotency` ON `notifications` (`idempotency_key`) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_notifications_recipient` ON `notifications` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_created` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `scheduled_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`type` text NOT NULL,
	`channels` text,
	`payload` text NOT NULL,
	`contact_snapshot` text NOT NULL,
	`attachments` text,
	`email_overrides` text,
	`push_silent` integer DEFAULT false NOT NULL,
	`push_collapse_id` text,
	`data` text,
	`transactional` integer DEFAULT false NOT NULL,
	`idempotency_key` text,
	`group_key` text,
	`scheduled_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_due` ON `scheduled_notifications` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_group` ON `scheduled_notifications` (`group_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_scheduled_idempotency` ON `scheduled_notifications` (`idempotency_key`) WHERE idempotency_key IS NOT NULL AND status != 'cancelled';--> statement-breakpoint
CREATE TABLE `template_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`channel` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`subject` text,
	`body` text,
	`text_body` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_template_channels` ON `template_channels` (`template_id`,`channel`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`topic` text,
	`sample_data` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_templates_type` ON `templates` (`type`) WHERE deleted_at IS NULL;