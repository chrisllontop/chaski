import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { timestamp, timestampNow } from './timestamps';

// contactSnapshot freezes recipient data at ingest time so queue retries never
// depend on a contacts row that may have changed or disappeared.
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    contactSnapshot: text('contact_snapshot').notNull(),
    attachments: text('attachments'),
    emailOverrides: text('email_overrides'),
    transactional: integer('transactional', { mode: 'boolean' }).notNull().default(false),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('uq_notifications_idempotency')
      .on(t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    index('idx_notifications_recipient').on(t.recipientId, t.createdAt),
    index('idx_notifications_created').on(t.createdAt),
  ],
);

// `held` waits on a paused channel until someone sends or discards it from the dashboard.
export const DELIVERY_STATUS = ['pending', 'sent', 'failed', 'dead', 'skipped', 'held'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number];

export const SKIP_REASONS = [
  'channel_not_configured',
  'muted_by_preferences',
  'missing_email',
  'no_device_tokens',
  'no_template',
  'channel_not_available',
  'discarded',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const deliveries = sqliteTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    notificationId: text('notification_id')
      .notNull()
      .references(() => notifications.id),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('pending'),
    skipReason: text('skip_reason'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    errorCode: text('error_code'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at'),
    // How long the channel's provider took on the latest attempt, whatever it ended in.
    providerMs: integer('provider_ms'),
    // Email open tracking via pixel: openedAt freezes the first open. Opens are a
    // read receipt, not a delivery state — status stays 'sent' and the UI surfaces
    // openedAt as a separate "seen" indicator.
    openedAt: timestamp('opened_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_deliveries_channel').on(t.notificationId, t.channel),
    index('idx_deliveries_status').on(t.status, t.updatedAt),
    index('idx_deliveries_updated').on(t.updatedAt),
    index('idx_deliveries_opened').on(t.openedAt).where(sql`opened_at IS NOT NULL`),
    index('idx_deliveries_sent').on(t.sentAt).where(sql`sent_at IS NOT NULL`),
  ],
);

export const feedItems = sqliteTable(
  'feed_items',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id').notNull(),
    notificationId: text('notification_id')
      .notNull()
      .references(() => notifications.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: text('data'),
    readAt: timestamp('read_at'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_feed_recipient').on(t.recipientId, t.createdAt),
    index('idx_feed_unread').on(t.recipientId, t.createdAt).where(sql`read_at IS NULL`),
  ],
);

export const SCHEDULED_STATUS = ['pending', 'promoted', 'cancelled'] as const;
export type ScheduledStatus = (typeof SCHEDULED_STATUS)[number];

// The idempotency unique index excludes cancelled rows so a cancelled schedule's key
// can be reused, while pending/enqueued duplicates are still rejected.
export const scheduledNotifications = sqliteTable(
  'scheduled_notifications',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id').notNull(),
    type: text('type').notNull(),
    channels: text('channels'),
    payload: text('payload').notNull(),
    contactSnapshot: text('contact_snapshot').notNull(),
    attachments: text('attachments'),
    emailOverrides: text('email_overrides'),
    transactional: integer('transactional', { mode: 'boolean' }).notNull().default(false),
    idempotencyKey: text('idempotency_key'),
    groupKey: text('group_key'),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_scheduled_due').on(t.status, t.scheduledAt),
    index('idx_scheduled_group').on(t.groupKey),
    uniqueIndex('uq_scheduled_idempotency')
      .on(t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL AND status != 'cancelled'`),
  ],
);
