import type { Request } from './http';

export type PushOptions = {
  /** Where the host serves its service worker. Defaults to `/sw.js`. */
  serviceWorkerPath?: string;
  /** The scope it registers under. Defaults to `/`. */
  serviceWorkerScope?: string;
  /** `module` lets the worker file use ESM imports without a bundling step. */
  serviceWorkerType?: WorkerType;
};

export type PushState = {
  subscribed: boolean;
  permission: NotificationPermission | 'unsupported';
};

export type PushClient = {
  isSupported(): boolean;
  state(): Promise<PushState>;
  /** Asks for permission, subscribes this browser and registers it for the signed-in user. */
  enable(): Promise<void>;
  /** Unregisters this browser and drops its subscription. */
  disable(): Promise<void>;
};

const isPushSupported = () =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  typeof Notification !== 'undefined';

// pushManager.subscribe() takes the key as bytes; VAPID keys travel as base64url.
const keyBytes = (base64Url: string) => {
  const base64 = base64Url.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
};

const sameKey = (key: ArrayBuffer | null | undefined, expected: Uint8Array) => {
  if (!key || key.byteLength !== expected.length) return false;
  const bytes = new Uint8Array(key);
  return bytes.every((byte, index) => byte === expected[index]);
};

export const createPushClient = (request: Request, options: PushOptions = {}): PushClient => {
  const scope = options.serviceWorkerScope ?? '/';

  const currentSubscription = async () => {
    const registration = await navigator.serviceWorker.getRegistration(scope);
    return (await registration?.pushManager.getSubscription()) ?? null;
  };

  return {
    isSupported: isPushSupported,
    state: async () => {
      if (!isPushSupported()) return { subscribed: false, permission: 'unsupported' };
      return {
        subscribed: Boolean(await currentSubscription()),
        permission: Notification.permission,
      };
    },
    enable: async () => {
      if (!isPushSupported()) throw new Error('this browser does not support web push');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('notification permission was not granted');

      const { publicKey } = await request<{ publicKey: string | null }>(
        'GET',
        '/push/vapid-public-key',
      );
      if (!publicKey) throw new Error('web push is not configured on the server');

      const registration = await navigator.serviceWorker.register(
        options.serviceWorkerPath ?? '/sw.js',
        { scope, type: options.serviceWorkerType },
      );
      const applicationServerKey = keyBytes(publicKey);
      let subscription = await registration.pushManager.getSubscription();
      // A subscription made with another key can never receive this server's pushes.
      if (
        subscription &&
        !sameKey(subscription.options.applicationServerKey, applicationServerKey)
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const { endpoint, keys } = subscription.toJSON();
      if (!endpoint || !keys?.p256dh || !keys.auth) {
        throw new Error('the browser returned an incomplete push subscription');
      }
      await request('POST', '/push/subscriptions', {
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      });
    },
    disable: async () => {
      if (!isPushSupported()) return;
      const subscription = await currentSubscription();
      if (!subscription) return;
      await request('DELETE', '/push/subscriptions', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    },
  };
};
