import { exports } from 'cloudflare:workers';
import { Hono } from 'hono';
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
    await vi.waitFor(() =>
      expect(received).toEqual([expect.objectContaining({ feedItemId: item?.id })]),
    );
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

  it('registers an Android device and unregisters it by its token', async () => {
    const deviceToken = `cQ1:APA91bF${'Zx-9_Yw'.repeat(20)}`;
    const register = await me('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ platform: 'android', deviceToken }),
    });
    const unregister = await me('/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ deviceToken }),
    });

    expect(register.status).toBe(201);
    expect(await json(unregister)).toEqual({ unregistered: 1 });
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
  it('leaves a path it does not serve to the host, without asking identify', async () => {
    const response = await me('/whatever', { user: null });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('a second mount for a shared inbox', () => {
  const team = (path: string, init: RequestInit = {}) =>
    exports.default.fetch(`${ORIGIN}/me/team-notifications${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'x-fixture-user': 'user_1',
        ...init.headers,
      },
    });

  it('keeps its own feed and count for the same signed-in user', async () => {
    await seedTemplate('payment_received', 'in_app');
    await sendInApp('team:user_1');
    await sendInApp('team:user_1');
    await sendInApp('user_1');

    expect(await json(await team('/feed/unread-count'))).toEqual({ unread: 2 });
    expect(await json(await me('/feed/unread-count'))).toEqual({ unread: 1 });
    expect((await json<FeedPage>(await team('/feed'))).items).toHaveLength(2);
    await team('/feed/read', { method: 'POST', body: '{}' });
    expect(await json(await team('/feed/unread-count'))).toEqual({ unread: 0 });
    expect(await json(await me('/feed/unread-count'))).toEqual({ unread: 1 });
  });

  it('signals its own socket only', async () => {
    await seedTemplate('payment_received', 'in_app');
    const open = async (fetcher: typeof me) => {
      const socket = (await fetcher('/feed/socket', { headers: { upgrade: 'websocket' } }))
        .webSocket;
      if (!socket) throw new Error('no upgrade');
      socket.accept();
      const received: unknown[] = [];
      socket.addEventListener('message', (event) => received.push(event.data));
      return { socket, received };
    };
    const personal = await open(me);
    const shared = await open(team);

    await sendInApp('user_1');

    await vi.waitFor(() => expect(personal.received).toHaveLength(1));
    expect(shared.received).toEqual([]);
    personal.socket.close();
    shared.socket.close();
  });

  // One browser belongs to one contact: registering it here would take it from the user's own inbox.
  it('serves the feed alone with groups: [feed]', async () => {
    const register = await team('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(SUBSCRIPTION),
    });
    const preferences = await team('/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ mutedTypes: ['payment_received'] }),
    });

    expect(register.status).toBe(404);
    expect(preferences.status).toBe(404);
    expect((await team('/feed/unread-count')).status).toBe(200);
    expect(await getClient().deviceTokens.count({ where: {} })).toBe(0);
    expect(await getClient().preferences.count({ where: {} })).toBe(0);
  });
});

describe('allowPush', () => {
  const host = new Hono().route(
    '/me',
    chaski.userRoutes({
      identify: (c) => c.req.header('x-user') ?? null,
      allowPush: (_c, recipientId) => !recipientId.startsWith('guest'),
    }),
  );
  const call = (user: string, method: string) =>
    host.request('/me/push/subscriptions', {
      method,
      headers: { 'x-user': user, 'content-type': 'application/json' },
      body: JSON.stringify(method === 'POST' ? SUBSCRIPTION : { endpoint: SUBSCRIPTION.endpoint }),
    });

  it('answers 403 to a contact it turns away, and lets anyone drop a device', async () => {
    const refused = await call('guest_1', 'POST');
    const accepted = await call('user_1', 'POST');

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: 'forbidden',
      message: 'this contact may not register devices',
    });
    expect(accepted.status).toBe(201);
    expect((await call('guest_1', 'DELETE')).status).toBe(200);
  });
});

// A mount must not answer for paths it doesn't serve, so mounts nested under its path work in
// whichever order the host registers them, and its identify doesn't run for them.
describe('nested mounts', () => {
  const personal = () =>
    chaski.userRoutes({ identify: (c) => c.req.header('x-user') ?? null, groups: ['feed'] });
  const team = () => chaski.userRoutes({ identify: () => 'team:shared', groups: ['feed'] });

  it.each([
    [
      'the outer mount first',
      () => new Hono().route('/inbox', personal()).route('/inbox/team', team()),
    ],
    [
      'the inner mount first',
      () => new Hono().route('/inbox/team', team()).route('/inbox', personal()),
    ],
  ])('answers both with %s', async (_, build) => {
    await seedTemplate('payment_received', 'in_app');
    await sendInApp('team:shared');
    const host = build();

    const teamCount = await host.request('/inbox/team/feed/unread-count');
    const personalCount = await host.request('/inbox/feed/unread-count', {
      headers: { 'x-user': 'user_1' },
    });

    expect(teamCount.status).toBe(200);
    expect(await teamCount.json()).toEqual({ unread: 1 });
    expect(await personalCount.json()).toEqual({ unread: 0 });
    expect((await host.request('/inbox/elsewhere')).status).toBe(404);
  });
});
