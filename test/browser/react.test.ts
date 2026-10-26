import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createChaskiClient, type FeedItem } from '../../src/client';
import {
  ChaskiProvider,
  useFeed,
  useFeedConnection,
  usePreferences,
  useUnreadCount,
} from '../../src/react';
import { fakeFetch, socketFactory } from './fakes';

const item = (id: string, readAt: string | null = null): FeedItem => ({
  id,
  type: 'payment_received',
  title: 'Paid',
  body: id,
  readAt,
  createdAt: '2026-10-23T12:00:00.000Z',
});

// A server holding one recipient's feed, two items per page.
const server = (initial: FeedItem[]) => {
  let items = [...initial];
  let preferences = { channels: {}, mutedTypes: [] as string[] };
  const network = fakeFetch({
    'GET /me/notifications/feed': () => ({ items: items.slice(0, 2), nextCursor: null }),
    'GET /me/notifications/feed/unread-count': () => ({
      unread: items.filter((i) => i.readAt === null).length,
    }),
    'POST /me/notifications/feed/read': (body) => {
      const ids = (body as { ids?: string[] }).ids;
      items = items.map((i) => (!ids || ids.includes(i.id) ? { ...i, readAt: 'now' } : i));
      return { marked: ids?.length ?? items.length };
    },
    'GET /me/notifications/preferences': () => preferences,
    'PATCH /me/notifications/preferences': (body) => {
      preferences = { ...preferences, ...(body as object) };
      return preferences;
    },
    'GET /me/notifications/preferences/topics': () => [{ topic: 'billing', types: ['paid'] }],
  });
  const sockets = socketFactory();
  const client = createChaskiClient({
    baseUrl: '/me/notifications',
    fetch: network.fetch,
    feed: { socketFactory: sockets.factory },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ChaskiProvider, { client }, children);
  return {
    wrapper,
    sockets: sockets.sockets,
    add: (next: FeedItem) => {
      items = [next, ...items];
    },
  };
};

describe('useFeed', () => {
  it('loads the feed and adds new items when the socket signals', async () => {
    const feed = server([item('f2'), item('f1')]);
    const { result } = renderHook(() => useFeed(), { wrapper: feed.wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((i) => i.id)).toEqual(['f2', 'f1']);

    feed.add(item('f3'));
    act(() => {
      feed.sockets[0]?.open();
      feed.sockets[0]?.receive(
        JSON.stringify({ type: 'feed_item.created', feedItemId: 'f3', createdAt: 'now' }),
      );
    });

    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['f3', 'f2', 'f1']));
  });

  it('marks items read and keeps the unread count in step', async () => {
    const feed = server([item('f2'), item('f1')]);
    const { result } = renderHook(() => ({ feed: useFeed(), count: useUnreadCount() }), {
      wrapper: feed.wrapper,
    });
    await waitFor(() => expect(result.current.count.unread).toBe(2));

    await act(() => result.current.feed.markRead(['f2']));

    expect(result.current.feed.items.find((i) => i.id === 'f2')?.readAt).not.toBeNull();
    await waitFor(() => expect(result.current.count.unread).toBe(1));
  });

  it('waits to load while disabled', () => {
    const feed = server([item('f1')]);
    const { result } = renderHook(() => useFeed({ enabled: false }), { wrapper: feed.wrapper });

    expect(result.current.status).toBe('idle');
    expect(feed.sockets).toEqual([]);
  });
});

describe('useFeedConnection', () => {
  it('follows the socket', async () => {
    const feed = server([]);
    const { result } = renderHook(() => ({ feed: useFeed(), connection: useFeedConnection() }), {
      wrapper: feed.wrapper,
    });
    expect(result.current.connection).toBe('connecting');

    act(() => feed.sockets[0]?.open());

    expect(result.current.connection).toBe('open');
  });
});

describe('usePreferences', () => {
  it('loads the preferences and the topics, and saves an update', async () => {
    const feed = server([]);
    const { result } = renderHook(() => usePreferences(), { wrapper: feed.wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.topics).toEqual([{ topic: 'billing', types: ['paid'] }]);

    await act(() => result.current.update({ mutedTypes: ['paid'] }));

    expect(result.current.preferences).toEqual({ channels: {}, mutedTypes: ['paid'] });
  });
});

describe('ChaskiProvider', () => {
  it('is required above the hooks', () => {
    expect(() => renderHook(() => useFeed())).toThrowError(
      'Chaski hooks need a <ChaskiProvider> above them',
    );
  });
});
