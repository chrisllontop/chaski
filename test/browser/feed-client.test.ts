import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChaskiRequestError,
  createChaskiClient,
  type FeedConnectionStatus,
} from '../../src/client';
import { fakeFetch, socketFactory } from './fakes';

const BASE = '/me/notifications';
const PAGE = { items: [], nextCursor: null };

const ITEM = {
  id: 'f1',
  notificationId: 'n_1',
  type: 'payment_received',
  title: 'Paid',
  body: '1500',
  data: { eventId: 'evt_1' },
  readAt: null,
  createdAt: '2026-10-30T12:00:00.000Z',
};

const setup = (routes = {}, feed = {}) => {
  const network = fakeFetch({
    'GET /me/notifications/feed': () => PAGE,
    'GET /me/notifications/feed/unread-count': () => ({ unread: 0 }),
    ...routes,
  });
  const sockets = socketFactory();
  const client = createChaskiClient({
    baseUrl: `${BASE}/`,
    fetch: network.fetch,
    feed: { socketFactory: sockets.factory, ...feed },
  });
  const statuses: FeedConnectionStatus[] = [];
  client.feed.onStatusChange((status) => statuses.push(status));
  return { client, network, sockets: sockets.sockets, statuses };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('feed requests', () => {
  it('reads and marks the feed through the user routes', async () => {
    const { client, network } = setup({
      'POST /me/notifications/feed/read': () => ({ marked: 2 }),
    });

    await client.feed.list({ limit: 20, unreadOnly: true, cursor: 'c1' });
    await client.feed.unreadCount();
    expect(await client.feed.markRead({ ids: ['f1', 'f2'] })).toEqual({ marked: 2 });
    await client.feed.markRead();

    expect(network.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /me/notifications/feed?cursor=c1&limit=20&unreadOnly=true',
      'GET /me/notifications/feed/unread-count',
      'POST /me/notifications/feed/read',
      'POST /me/notifications/feed/read',
    ]);
    // An empty body means the whole feed, so the client always sends one.
    expect(network.calls.at(-1)?.body).toEqual({});
  });

  it('turns an error answer into a ChaskiRequestError with the code and status', async () => {
    const { client } = setup({
      'GET /me/notifications/feed': () =>
        Response.json({ error: 'unauthorized', message: 'not signed in' }, { status: 401 }),
    });

    const error = await client.feed.list().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChaskiRequestError);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized', message: 'not signed in' });
  });
});

describe('feed socket', () => {
  it('opens on the first listener and closes after the last one leaves', () => {
    const { client, sockets, statuses } = setup();

    const stopA = client.feed.subscribe(() => {});
    const stopB = client.feed.subscribe(() => {});
    sockets[0]?.open();
    stopA();
    expect(sockets[0]?.closed).toBe(false);
    stopB();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe('wss://app.example.com/me/notifications/feed/socket');
    expect(sockets[0]?.closed).toBe(true);
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
  });

  it('passes on the events it knows and skips the rest', () => {
    const { client, sockets } = setup();
    const events: unknown[] = [];
    client.feed.subscribe((event) => events.push(event));
    sockets[0]?.open();

    sockets[0]?.receive(JSON.stringify({ type: 'feed_item.created', item: ITEM }));
    sockets[0]?.receive(JSON.stringify({ type: 'feed_item.read', ids: ['f1'] }));
    sockets[0]?.receive(JSON.stringify({ type: 'feed_item.deleted', id: 'f1' }));
    sockets[0]?.receive('pong');
    sockets[0]?.receive('not json');

    expect(events).toEqual([
      { type: 'feed_item.created', item: ITEM },
      { type: 'feed_item.read', ids: ['f1'] },
    ]);
  });

  it('tells listeners to check again when the socket comes back, not when it first opens', async () => {
    const { client, sockets } = setup({}, { reconnect: { minDelayMs: 1_000 } });
    const listener = vi.fn();
    client.feed.subscribe(listener);
    sockets[0]?.open();
    expect(listener).not.toHaveBeenCalled();

    sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1]?.open();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(undefined);
  });

  it('tells listeners to check again when the first connection only opens on a retry', async () => {
    const { client, sockets } = setup({}, { reconnect: { minDelayMs: 1_000 } });
    const listener = vi.fn();
    client.feed.subscribe(listener);
    sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(1_000);

    sockets[1]?.open();

    expect(listener).toHaveBeenCalledWith(undefined);
  });

  it('hands the factory a ws URL outside a browser when baseUrl is absolute', () => {
    vi.stubGlobal('location', undefined);
    const sockets = socketFactory();
    const client = createChaskiClient({
      baseUrl: 'https://api.example.com/me/notifications',
      fetch: fakeFetch({}).fetch,
      feed: { socketFactory: sockets.factory },
    });

    client.feed.subscribe(() => {});

    expect(sockets.sockets[0]?.url).toBe('wss://api.example.com/me/notifications/feed/socket');
    vi.unstubAllGlobals();
  });

  it('reconnects with backoff after the socket drops', async () => {
    const { client, sockets, statuses } = setup({}, { reconnect: { minDelayMs: 1_000 } });
    client.feed.subscribe(() => {});
    sockets[0]?.open();

    sockets[0]?.drop();
    expect(client.feed.status()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1]?.open();

    expect(sockets).toHaveLength(2);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('treats a missing pong as a dead connection', async () => {
    const { client, sockets } = setup({}, { heartbeatMs: 5_000 });
    client.feed.subscribe(() => {});
    sockets[0]?.open();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets[0]?.sent).toEqual(['ping']);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(sockets[0]?.closed).toBe(true);
    expect(client.feed.status()).toBe('reconnecting');
  });

  it('falls back to polling the unread count once reconnecting gives up', async () => {
    let unread = 1;
    const { client, sockets } = setup(
      { 'GET /me/notifications/feed/unread-count': () => ({ unread }) },
      { reconnect: { minDelayMs: 100, maxDelayMs: 100, maxAttempts: 1 }, pollIntervalMs: 1_000 },
    );
    const listener = vi.fn();
    client.feed.subscribe(listener);
    await client.feed.unreadCount();
    sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(100);
    sockets[1]?.drop();
    expect(client.feed.status()).toBe('polling');

    unread = 3;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(listener).toHaveBeenCalledWith(undefined);
  });
});
