import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { timestamp, timestampNow } from './timestamps';

// A template is one notification type; the per-channel content lives in
// template_channels so every channel of a type is designed in one place.
export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    description: text('description'),
    // Free-form group label; consumers group preference toggles by it.
    topic: text('topic'),
    sampleData: text('sample_data'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [uniqueIndex('uq_templates_type').on(t.type).where(sql`deleted_at IS NULL`)],
);

// Delivery only renders a channel row when `enabled` is on AND a body exists,
// so drafts can be edited without affecting live sends.
export const templateChannels = sqliteTable(
  'template_channels',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    subject: text('subject'),
    body: text('body'),
    textBody: text('text_body'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [uniqueIndex('uq_template_channels').on(t.templateId, t.channel)],
);

// A channel's content in one more language; the channel row holds it in the default language, and
// its `enabled` decides for every language. Each field is the translation's own, never the
// default's. `source_hash` fingerprints the default content the translation was written from, so
// it reads as outdated once that content changes, until it is saved again or marked current.
export const templateTranslations = sqliteTable(
  'template_translations',
  {
    templateChannelId: text('template_channel_id')
      .notNull()
      .references(() => templateChannels.id, { onDelete: 'cascade' }),
    // Canonical BCP 47, as Intl.getCanonicalLocales writes it: `es-PE`, never `es-pe`.
    locale: text('locale').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    textBody: text('text_body'),
    sourceHash: text('source_hash').notNull(),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.templateChannelId, t.locale] })],
);
