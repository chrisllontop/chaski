import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChaskiClient } from '../../src/client';
import { fakeFetch } from './fakes';

// The VAPID key the server hands out, and its bytes.
const VAPID_KEY = 'BAECAwQ';
const VAPID_BYTES = [4, 1, 2, 3, 4];

type FakeSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: () => Promise<boolean>;
};

const browser = (permission: NotificationPermission = 'granted') => {
  let current: FakeSubscription | null = null;
  const subscription = (endpoint: string, key: number[]): FakeSubscription => ({
    endpoint,
    options: { applicationServerKey: new Uint8Array(key).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => {
      current = null;
      return true;
    }),
  });
  const pushManager = {
    getSubscription: async () => current,
    subscribe: vi.fn(async (options: { applicationServerKey: Uint8Array }) => {
      current = subscription('https://push.example/sub/new', [...options.applicationServerKey]);
      return current;
    }),
  };
  const serviceWorker = {
    register: vi.fn(async () => ({ pushManager })),
    getRegistration: async () => ({ pushManager }),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal(
    'Notification',
    Object.assign(class {}, { permission, requestPermission: vi.fn(async () => permission) }),
  );
  return {
    pushManager,
    serviceWorker,
    subscribed: (endpoint: string, key: number[]) => {
      current = subscription(endpoint, key);
      return current;
    },
  };
};

const client = (register: () => unknown = () => ({ id: 'dt_1' })) => {
  const network = fakeFetch({
    'GET /me/notifications/push/vapid-public-key': () => ({ publicKey: VAPID_KEY }),
    'POST /me/notifications/push/subscriptions': register,
    'DELETE /me/notifications/push/subscriptions': () => ({ unregistered: 1 }),
  });
  const chaski = createChaskiClient({
    baseUrl: '/me/notifications',
    fetch: network.fetch,
    push: { serviceWorkerPath: '/worker.js' },
  });
  return { push: chaski.push, network };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('push client', () => {
  it('subscribes this browser with the server key and registers it', async () => {
    const fake = browser();
    const { push, network } = client();

    await push.enable();

    expect(fake.serviceWorker.register).toHaveBeenCalledWith('/worker.js', {
      scope: '/',
      type: undefined,
    });
    expect([...(fake.pushManager.subscribe.mock.calls[0]?.[0].applicationServerKey ?? [])]).toEqual(
      VAPID_BYTES,
    );
    expect(network.calls.at(-1)).toEqual({
      method: 'POST',
      url: '/me/notifications/push/subscriptions',
      body: {
        endpoint: 'https://push.example/sub/new',
        keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
      },
    });
    expect(await push.state()).toEqual({ subscribed: true, permission: 'granted' });
  });

  it('subscribes again when the old subscription has another key', async () => {
    const fake = browser();
    const stale = fake.subscribed('https://push.example/sub/old', [4, 9, 9]);
    const { push } = client();

    await push.enable();

    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(fake.pushManager.subscribe).toHaveBeenCalled();
  });

  it('keeps a subscription made with the same key', async () => {
    const fake = browser();
    fake.subscribed('https://push.example/sub/kept', VAPID_BYTES);
    const { push, network } = client();

    await push.enable();

    expect(fake.pushManager.subscribe).not.toHaveBeenCalled();
    expect(network.calls.at(-1)?.body).toMatchObject({ endpoint: 'https://push.example/sub/kept' });
  });

  // As a browser that another push provider subscribed with its own key stands.
  it('reports a subscription made with another key as not subscribed until enable replaces it', async () => {
    const fake = browser();
    fake.subscribed('https://push.example/sub/old', [4, 9, 9]);
    const { push } = client();

    expect(await push.state()).toEqual({ subscribed: false, permission: 'granted' });
    await push.enable();
    expect(await push.state()).toEqual({ subscribed: true, permission: 'granted' });
  });

  it('drops the subscription it just made when the server refuses the browser', async () => {
    const fake = browser();
    const { push } = client(() =>
      Response.json(
        { error: 'forbidden', message: 'this contact may not register devices' },
        { status: 403 },
      ),
    );

    await expect(push.enable()).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(await fake.pushManager.getSubscription()).toBeNull();
    expect(await push.state()).toEqual({ subscribed: false, permission: 'granted' });
  });

  it('stops when the user denies permission', async () => {
    browser('denied');
    const { push, network } = client();

    await expect(push.enable()).rejects.toThrowError('notification permission was not granted');
    expect(network.calls).toEqual([]);
  });

  it('unregisters and drops the subscription', async () => {
    const fake = browser();
    const current = fake.subscribed('https://push.example/sub/1', VAPID_BYTES);
    const { push, network } = client();

    await push.disable();

    expect(network.calls).toEqual([
      {
        method: 'DELETE',
        url: '/me/notifications/push/subscriptions',
        body: { endpoint: 'https://push.example/sub/1' },
      },
    ]);
    expect(current.unsubscribe).toHaveBeenCalled();
  });

  it('reports a browser without push', async () => {
    const { push } = client();

    expect(await push.state()).toEqual({ subscribed: false, permission: 'unsupported' });
  });
});
