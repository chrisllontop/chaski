import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FeedItem, FeedPage, FeedSocketEvent } from '../../contract/contract';
import { listFeedQuerySchema, markFeedReadSchema } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { feedItems, notifications } from '../db/schema';
import { feedStub } from '../durable/feed';
import { parseJson } from '../lib/json';
import { reportError } from '../lib/report-error';
import { parseInput } from '../lib/validate';
import { BaseService } from './base.service';

const DEFAULT_PAGE_SIZE = 20;

// Keyset cursor over (createdAt, id): createdAt is stored as epoch milliseconds,
// so the comparison never depends on string formatting.
const encodeCursor = (createdAt: Date, id: string) => `${createdAt.getTime()}~${id}`;

const decodeCursor = (cursor: string): { createdAt: Date; id: string } => {
  const at = cursor.indexOf('~');
  const epochMilliseconds = Number(cursor.slice(0, at));
  if (at <= 0 || at === cursor.length - 1 || !Number.isSafeInteger(epochMilliseconds)) {
    throw new ChaskiError('validation', 'malformed feed cursor');
  }
  return { createdAt: new Date(epochMilliseconds), id: cursor.slice(at + 1) };
};

type FeedItemRow = Pick<
  typeof feedItems.$inferSelect,
  'id' | 'notificationId' | 'title' | 'body' | 'data' | 'readAt' | 'createdAt'
> & { type: string; notificationData: string | null };

// The feed item keeps its rendered link in its own data; the send's data stays on the
// notification, where it is one fact.
export const toFeedItem = (row: FeedItemRow): FeedItem => ({
  id: row.id,
  notificationId: row.notificationId,
  type: row.type,
  title: row.title,
  body: row.body,
  href: parseJson<{ href?: string }>(row.data, {}).href,
  data: parseJson<Record<string, string> | null>(row.notificationData, null),
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export class FeedService extends BaseService {
  protected static override name = 'feed';

  static list = async (rawQuery: unknown): Promise<FeedPage> => {
    const query = parseInput(listFeedQuerySchema, rawQuery);
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const conditions = [eq(feedItems.recipientId, query.recipientId)];
    if (query.unreadOnly) conditions.push(isNull(feedItems.readAt));
    if (query.cursor) {
      const { createdAt, id } = decodeCursor(query.cursor);
      const boundary = or(
        lt(feedItems.createdAt, createdAt),
        and(eq(feedItems.createdAt, createdAt), lt(feedItems.id, id)),
      );
      if (boundary) conditions.push(boundary);
    }

    // One extra row tells whether another page exists without a count query.
    const rows = await FeedService.db
      .select({
        id: feedItems.id,
        notificationId: feedItems.notificationId,
        title: feedItems.title,
        body: feedItems.body,
        data: feedItems.data,
        readAt: feedItems.readAt,
        createdAt: feedItems.createdAt,
        type: notifications.type,
        notificationData: notifications.data,
      })
      .from(feedItems)
      .innerJoin(notifications, eq(notifications.id, feedItems.notificationId))
      .where(and(...conditions))
      .orderBy(desc(feedItems.createdAt), desc(feedItems.id))
      .limit(limit + 1)
      .all();

    const page = rows.slice(0, limit);
    const items = page.map(toFeedItem);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  };

  static unreadCount = async (recipientId: string): Promise<{ unread: number }> => {
    if (!recipientId || recipientId.length > 256) {
      throw new ChaskiError('validation', 'recipientId must be 1-256 characters');
    }
    const row = await FeedService.db
      .select({ unread: sql<number>`count(*)` })
      .from(feedItems)
      .where(and(eq(feedItems.recipientId, recipientId), isNull(feedItems.readAt)))
      .get();
    return { unread: row?.unread ?? 0 };
  };

  static markRead = async (rawInput: unknown): Promise<{ marked: number }> => {
    const input = parseInput(markFeedReadSchema, rawInput);
    if (input.ids?.length === 0) return { marked: 0 };

    const conditions = [eq(feedItems.recipientId, input.recipientId), isNull(feedItems.readAt)];
    if (input.ids) conditions.push(inArray(feedItems.id, input.ids));
    if (input.before) conditions.push(lte(feedItems.createdAt, new Date(input.before)));

    const readAt = new Date();
    const result = await FeedService.db
      .update(feedItems)
      .set({ readAt })
      .where(and(...conditions));
    if (result.meta.changes > 0) {
      await FeedService.signalRead(input.recipientId, {
        type: 'feed_item.read',
        ids: input.ids,
        before: input.before ?? (input.ids ? undefined : readAt.toISOString()),
      });
    }
    return { marked: result.meta.changes };
  };

  // The reads are stored; a lost signal only leaves the recipient's other tabs and devices
  // counting them until their next refetch, so it must not fail the request.
  private static signalRead = async (recipientId: string, event: FeedSocketEvent) => {
    if (!FeedService.bindings.feed) return;
    try {
      await feedStub(recipientId).publish(event);
    } catch (error) {
      reportError(error, { source: 'feed' });
      FeedService.log.error('feed read signal failed', error, { recipientId });
    }
  };
}
