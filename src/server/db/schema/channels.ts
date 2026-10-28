import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { timestampNow } from './timestamps';

// A row per paused channel; resuming deletes it. Pausing is runtime state, kept out of the host's
// config so a deploy never resumes a channel someone stopped. The actor is whoever the
// dashboard's authorize let in, frozen as it was then: Chaski keeps no table of its own for them.
export const channelPauses = sqliteTable('channel_pauses', {
  channel: text('channel').primaryKey(),
  pausedById: text('paused_by_id').notNull(),
  pausedByName: text('paused_by_name'),
  pausedAt: timestampNow('paused_at'),
});
