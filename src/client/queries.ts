import type { ChaskiPreferences, FeedPage } from '../contract/contract';
import type { FeedListQuery } from './feed';
import type { ChaskiClient } from './index';

export type QueryDescriptor<T> = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
};

export const CHASKI_QUERY_KEY = ['chaski'] as const;

/**
 * `{ queryKey, queryFn }` pairs for apps that already run a query cache
 * (TanStack Query, SWR and the like), so Chaski's data lives in that cache
 * instead of a second copy. Invalidate CHASKI_QUERY_KEY when the feed signals.
 */
export const chaskiQueries = (client: ChaskiClient) => ({
  feed: (query: FeedListQuery = {}): QueryDescriptor<FeedPage> => ({
    queryKey: [...CHASKI_QUERY_KEY, 'feed', query],
    queryFn: () => client.feed.list(query),
  }),
  unreadCount: (): QueryDescriptor<{ unread: number }> => ({
    queryKey: [...CHASKI_QUERY_KEY, 'unread-count'],
    queryFn: () => client.feed.unreadCount(),
  }),
  preferences: (): QueryDescriptor<ChaskiPreferences> => ({
    queryKey: [...CHASKI_QUERY_KEY, 'preferences'],
    queryFn: () => client.preferences.get(),
  }),
});
