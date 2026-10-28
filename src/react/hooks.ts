import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { FeedConnectionStatus } from '../client/feed';
import type { PushState } from '../client/push';
import type { ChaskiPreferences, FeedItem, PreferencesUpdate } from '../contract/contract';
import { useChaskiContext } from './provider';

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/** The state of the feed's realtime connection. */
export const useFeedConnection = (): FeedConnectionStatus => {
  const { feed } = useChaskiContext().client;
  return useSyncExternalStore(feed.onStatusChange, feed.status, () => 'idle' as const);
};

export type UseUnreadCountResult = { unread: number | null; refresh: () => Promise<void> };

/** The unread count, kept fresh by the socket (new items, reads elsewhere) and by local reads. */
export const useUnreadCount = (options: { enabled?: boolean } = {}): UseUnreadCountResult => {
  const { client, bus } = useChaskiContext();
  const { enabled = true } = options;
  const [unread, setUnread] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUnread((await client.feed.unreadCount()).unread);
    } catch {
      // Keep the last known count; the next signal tries again.
    }
  }, [client]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const unsubscribeFeed = client.feed.subscribe(() => void refresh());
    const unsubscribeBus = bus.subscribe(() => void refresh());
    return () => {
      unsubscribeFeed();
      unsubscribeBus();
    };
  }, [client, bus, refresh, enabled]);

  return { unread, refresh };
};

export type UseFeedOptions = {
  limit?: number;
  unreadOnly?: boolean;
  /** Holds the first load; a panel can pass false until it opens. */
  enabled?: boolean;
};

export type UseFeedResult = {
  items: FeedItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  hasMore: boolean;
  isLoadingMore: boolean;
  isMarkingRead: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
};

/** The signed-in user's feed, newest first, with new items added as they arrive. */
export const useFeed = (options: UseFeedOptions = {}): UseFeedResult => {
  const { client, bus } = useChaskiContext();
  const { limit, unreadOnly, enabled = true } = options;
  const origin = useId();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<UseFeedResult['status']>(enabled ? 'loading' : 'idle');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = nextCursor;
  const queryRef = useRef({ limit, unreadOnly });
  queryRef.current = { limit, unreadOnly };
  // Every full load takes a new generation; an answer from an older one
  // arrived late and must not overwrite fresher state.
  const generationRef = useRef(0);

  const load = useCallback(
    async (query: { limit?: number; unreadOnly?: boolean }) => {
      const generation = ++generationRef.current;
      try {
        const page = await client.feed.list(query);
        if (generation !== generationRef.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setStatus('ready');
      } catch {
        if (generation === generationRef.current) setStatus('error');
      }
    },
    [client],
  );

  const refresh = useCallback(() => load(queryRef.current), [load]);

  // A signal means new items at the head: reading the first page again and
  // prepending the unseen ones keeps the pages already loaded and the cursor.
  // It reads the generation without taking a new one, so a full load that
  // starts meanwhile wins.
  const mergeHead = useCallback(async () => {
    const generation = generationRef.current;
    try {
      const page = await client.feed.list(queryRef.current);
      if (generation !== generationRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...page.items.filter((item) => !seen.has(item.id)), ...current];
      });
    } catch {
      // The next signal tries again.
    }
  }, [client]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    setIsLoadingMore(true);
    try {
      const page = await client.feed.list({ ...queryRef.current, cursor });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }, [client]);

  useEffect(() => {
    if (!enabled) {
      // A load still in flight must not overwrite 'idle'.
      generationRef.current++;
      setStatus('idle');
      return;
    }
    setStatus('loading');
    void load({ limit, unreadOnly });
  }, [load, limit, unreadOnly, enabled]);

  const applyRead = useCallback((read: (item: FeedItem) => boolean) => {
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt === null && read(item) ? { ...item, readAt } : item)),
    );
  }, []);

  // Keyed on the client only, so changing the query refetches without
  // closing and reopening the socket. A read in another tab or device
  // arrives with what it marked, so it applies without a refetch.
  useEffect(() => {
    if (!enabled) return;
    return client.feed.subscribe((event) => {
      if (event?.type !== 'feed_item.read') {
        void mergeHead();
        return;
      }
      const ids = event.ids ? new Set(event.ids) : null;
      const before = event.before ? Date.parse(event.before) : null;
      applyRead(
        (item) =>
          (ids === null || ids.has(item.id)) &&
          (before === null || Date.parse(item.createdAt) <= before),
      );
    });
  }, [client, mergeHead, applyRead, enabled]);

  useEffect(
    () =>
      bus.subscribe((change) => {
        if (change.origin !== origin) {
          applyRead((item) => change.ids === null || change.ids.has(item.id));
        }
      }),
    [bus, origin, applyRead],
  );

  const commitRead = useCallback(
    async (ids: string[] | null) => {
      setIsMarkingRead(true);
      try {
        await client.feed.markRead(ids ? { ids } : {});
        const readIds = ids ? new Set(ids) : null;
        applyRead((item) => readIds === null || readIds.has(item.id));
        bus.emit({ ids: readIds, origin });
      } finally {
        setIsMarkingRead(false);
      }
    },
    [client, applyRead, bus, origin],
  );

  return {
    items,
    status,
    hasMore: nextCursor !== null,
    isLoadingMore,
    isMarkingRead,
    loadMore,
    refresh,
    markRead: useCallback((ids: string[]) => commitRead(ids), [commitRead]),
    markAllRead: useCallback(() => commitRead(null), [commitRead]),
  };
};

export type UsePushResult = {
  /** null until the first check finishes. */
  state: PushState | null;
  isPending: boolean;
  error: Error | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

/** Whether this browser gets the signed-in user's pushes, with the actions to change it. */
export const usePush = (): UsePushResult => {
  const { client } = useChaskiContext();
  const [state, setState] = useState<PushState | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setState(await client.push.state());
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setIsPending(true);
      setError(null);
      try {
        await action();
      } catch (caught) {
        setError(asError(caught));
      } finally {
        setIsPending(false);
        await refresh();
      }
    },
    [refresh],
  );

  return {
    state,
    isPending,
    error,
    enable: useCallback(() => run(client.push.enable), [run, client]),
    disable: useCallback(() => run(client.push.disable), [run, client]),
  };
};

export type UsePreferencesResult = {
  preferences: ChaskiPreferences | null;
  topics: Array<{ topic: string | null; types: string[] }>;
  status: 'loading' | 'ready' | 'error';
  error: Error | null;
  update: (update: PreferencesUpdate) => Promise<void>;
};

/** The signed-in user's preferences and the types they can mute, grouped by topic. */
export const usePreferences = (): UsePreferencesResult => {
  const { client } = useChaskiContext();
  const [preferences, setPreferences] = useState<ChaskiPreferences | null>(null);
  const [topics, setTopics] = useState<UsePreferencesResult['topics']>([]);
  const [status, setStatus] = useState<UsePreferencesResult['status']>('loading');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let current = true;
    setStatus('loading');
    Promise.all([client.preferences.get(), client.preferences.topics()])
      .then(([loaded, loadedTopics]) => {
        if (!current) return;
        setPreferences(loaded);
        setTopics(loadedTopics);
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setError(asError(caught));
        setStatus('error');
      });
    return () => {
      current = false;
    };
  }, [client]);

  const update = useCallback(
    async (change: PreferencesUpdate) => {
      setError(null);
      try {
        setPreferences(await client.preferences.update(change));
      } catch (caught) {
        setError(asError(caught));
        throw caught;
      }
    },
    [client],
  );

  return { preferences, topics, status, error, update };
};
