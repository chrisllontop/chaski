import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { timestampNow } from './timestamps';

// A row per paused channel; resuming deletes it. Pausing is runtime state, kept out of the
// config so a deploy never resumes a channel someone stopped. The actor is whoever Cloudflare
// Access signed in, frozen as it was then: Chaski keeps no table of its own for them.
export const channelPauses = sqliteTable('channel_pauses', {
  channel: text('channel').primaryKey(),
  pausedById: text('paused_by_id').notNull(),
  pausedByName: text('paused_by_name'),
  pausedAt: timestampNow('paused_at'),
});

export const SETTINGS_SECTIONS = [
  'email',
  'in_app',
  'vapid',
  'apns',
  'fcm',
  'wns',
  'default_muted_types',
  'locales',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

// A row per section someone saved on the Channels page, the Worker's languages included; removing
// a section deletes its row, which turns its channel, or its push provider, off. `value` holds the
// section's plain fields as one document, read and written whole; `secret` holds its one secret
// field (a private key, a service account, a client secret), sealed with CHASKI_SECRET and bound to
// the section, never in plain text. The actor is frozen as Access signed them in, as on
// channel_pauses.
export const settings = sqliteTable('settings', {
  section: text('section', { enum: SETTINGS_SECTIONS }).primaryKey(),
  value: text('value').notNull(),
  secret: text('secret'),
  updatedById: text('updated_by_id').notNull(),
  updatedByName: text('updated_by_name'),
  updatedAt: timestampNow('updated_at'),
});
