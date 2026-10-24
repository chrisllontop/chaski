import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedPage, FeedSocketEvent } from '../src';
import { getClient } from '../src/server/db';
import { chaski } from './fixture/worker';
import { processDeliveries, recipient, seedTemplate, seedTemplateType } from './helpers';

const ORIGIN = 'https://host.test';

const me = (path: string, init: RequestInit & { user?: string | null } = {}) => {
  const { user = 'user_1', ...rest } = init;
  return exports.default.fetch(`${ORIGIN}/me/notifications${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(user ? { 'x-fixture-user': user } : {}),
      ...rest.headers,
    },
  });
};

const json = async <T = Record<string, unknown>>(response: Response) =>
  (await response.json()) as T;

const sendInApp = async (recipientId: string) => {
  const result = await chaski.send({
    type: 'payment_received',
    recipient: recipient(recipientId),
    payload: { amount: 10 },
    channels: ['in_app'],
  });
  await processDeliveries(result.notificationId);
};

const SUBSCRIPTION = {
  endpoint: 'https://push.example/sub/1',
  keys: { p256dh: 'BKey', auth: 'secret' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('identify', () => {
  it('answers 401 when nobody is signed in', async () => {
    const response = await me('/feed', { user: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized', message: 'not signed in' });
  });

  it('refuses a write from a foreign origin and accepts the frontend the host lists', async () => {
    const foreign = await me('/feed/read', {
      method: 'POST',
      body: '{}',
      headers: { origin: 'https://attacker.test' },
    });
    const frontend = await me('/feed/read', {
      method: 'POST',
      body: '{}',
      headers: { origin: 'https://frontend.host.test' },
    });

    expect(foreign.status).toBe(403);
    expect(frontend.status).toBe(200);
  });
});

describe('feed', () => {
  it('lists, counts and marks only the signed-in user feed', async () => {
    await seedTemplate('payment_received', 'in_app');
    await sendInApp('user_1');
    await sendInApp('user_2');

    const page = await json<FeedPage>(await me('/feed?limit=10'));
    expect(page.items).toHaveLength(1);
    expect(await json(await me('/feed/unread-count'))).toEqual({ unread: 1 });

    expect(await json(await me('/feed/read', { method: 'POST', body: '{}' }))).toEqual({
      marked: 1,
    });
    expect(await chaski.feed.unreadCount('user_2')).toEqual({ unread: 1 });
  });

  it('refuses to mark read without a body instead of marking everything', async () => {
    const response = await me('/feed/read', { method: 'POST' });

    expect(response.status).toBe(400);
  });

  it('opens the signed-in user feed socket', async () => {
    await seedTemplate('payment_received', 'in_app');
    const response = await me('/feed/socket', { headers: { upgrade: 'websocket' } });
    const socket = response.webSocket;
    if (!socket) throw new Error(`no upgrade: ${response.status}`);
    socket.accept();
    const received: FeedSocketEvent[] = [];
    socket.addEventListener('message', (event) => {
      received.push(JSON.parse(String(event.data)));
    });

    await sendInApp('user_2');
    await sendInApp('user_1');

    const [item] = (await chaski.feed.list({ recipientId: 'user_1' })).items;
    await vi.waitFor(() => expect(received.map((event) => event.feedItemId)).toEqual([item?.id]));
    socket.close();
  });

  it('refuses a socket upgrade from a foreign origin', async () => {
    const response = await me('/feed/socket', {
      headers: { upgrade: 'websocket', origin: 'https://attacker.test' },
    });

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });
});

describe('push devices', () => {
  it('registers a browser for the signed-in user', async () => {
    const response = await me('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(SUBSCRIPTION),
      headers: { 'user-agent': 'Firefox' },
    });

    expect(response.status).toBe(201);
    expect(await getClient().deviceTokens.findMany({ where: {} })).toEqual([
      expect.objectContaining({
        recipientId: 'user_1',
        platform: 'web',
        token: SUBSCRIPTION.endpoint,
      }),
    ]);
  });

  it('registers an iOS device', async () => {
    const response = await me('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ platform: 'ios', deviceToken: 'AB'.repeat(32) }),
    });

    expect(response.status).toBe(201);
  });

  it('only unregisters the signed-in user devices', async () => {
    await me('/push/subscriptions', { method: 'POST', body: JSON.stringify(SUBSCRIPTION) });

    const other = await me('/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: SUBSCRIPTION.endpoint }),
      user: 'user_2',
    });
    const owner = await me('/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: SUBSCRIPTION.endpoint }),
    });

    expect(await json(other)).toEqual({ unregistered: 0 });
    expect(await json(owner)).toEqual({ unregistered: 1 });
  });

  it('hands out the VAPID public key, null without push configured', async () => {
    expect(await json(await me('/push/vapid-public-key'))).toEqual({ publicKey: null });
  });
});

describe('preferences', () => {
  it('reads and updates the signed-in user preferences', async () => {
    const updated = await me('/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ channels: { email: false }, mutedTypes: ['digest'] }),
    });

    expect(await json(updated)).toEqual({ channels: { email: false }, mutedTypes: ['digest'] });
    expect(await json(await me('/preferences'))).toEqual({
      channels: { email: false },
      mutedTypes: ['digest'],
    });
    expect(await chaski.preferences.get('user_2')).toEqual({ channels: {}, mutedTypes: [] });
  });

  it('lists the template types by topic', async () => {
    await seedTemplateType('payment_received', { topic: 'billing' });

    expect(await json(await me('/preferences/topics'))).toEqual([
      { topic: 'billing', types: ['payment_received'] },
    ]);
  });
});

describe('routes', () => {
  it('answers 404 in JSON for anything else', async () => {
    const response = await me('/whatever');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
  });
});
