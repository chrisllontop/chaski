ALTER TABLE `deliveries` ADD `provider_ms` integer;--> statement-breakpoint
CREATE INDEX `idx_deliveries_sent` ON `deliveries` (`sent_at`) WHERE sent_at IS NOT NULL;