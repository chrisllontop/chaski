import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { timestampNow } from './timestamps';

// Upserted from inline recipient data on every send (last-write-wins); push
// tokens have no inline equivalent and only live in device_tokens.
export const contacts = sqliteTable('contacts', {
  recipientId: text('recipient_id').primaryKey(),
  email: text('email'),
  name: text('name'),
  phoneE164: text('phone_e164'),
  timezone: text('timezone'),
  locale: text('locale'),
  createdAt: timestampNow('created_at'),
  updatedAt: timestampNow('updated_at'),
});

// Consulted on every non-transactional send.
export const preferences = sqliteTable('preferences', {
  recipientId: text('recipient_id').primaryKey(),
  channels: text('channels').notNull(),
  mutedTypes: text('muted_types').notNull().default('[]'),
  updatedAt: timestampNow('updated_at'),
});

export const DEVICE_PLATFORMS = ['web', 'ios', 'macos', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const deviceTokens = sqliteTable(
  'device_tokens',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id').notNull(),
    platform: text('platform').notNull(),
    token: text('token').notNull(),
    meta: text('meta'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    // A token identifies a physical device installation, which only one
    // recipient can own at a time: re-registering an existing token reassigns
    // it to the latest recipient (last-write-wins) instead of duplicating it.
    uniqueIndex('uq_device_tokens_token').on(t.token),
    index('idx_device_tokens_recipient').on(t.recipientId),
  ],
);
