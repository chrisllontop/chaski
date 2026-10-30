import type { NativeDevice } from '../contract/contract';
import type { FeedDeviceLink } from './feed';
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
  /** Whether this browser gets the server's pushes: a subscription made with another key doesn't. */
  subscribed: boolean;
  permission: NotificationPermission | 'unsupported';
};

export type RegisterDeviceOptions = {
  /**
   * While this client's feed socket is open, the device gets the notifications that also go to
   * the feed through the feed instead of a push, for an app that shows them itself while it runs.
   */
  feedWhileOpen?: boolean;
};

export type PushClient = {
  isSupported(): boolean;
  state(): Promise<PushState>;
  /** Asks for permission, subscribes this browser and registers it for the signed-in user. */
  enable(): Promise<void>;
  /** Unregisters this browser and drops its subscription. */
  disable(): Promise<void>;
  /**
   * Registers an app's device token for the signed-in user, such as the APNs token Electron's
   * `pushNotifications.registerForAPNSNotifications()` resolves with.
   */
  registerDevice(device: NativeDevice, options?: RegisterDeviceOptions): Promise<{ id: string }>;
  /** Unregisters a device token of the signed-in user, when they sign out of the app. */
  unregisterDevice(deviceToken: string): Promise<void>;
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

export const createPushClient = (
  request: Request,
  options: PushOptions = {},
  feed?: FeedDeviceLink,
): PushClient => {
  const scope = options.serviceWorkerScope ?? '/';
  // The device this client's feed socket names, by its token, so unregistering it lets go.
  let linkedToken: string | null = null;
  const link = (token: string | null, id: string | null) => {
    linkedToken = token;
    feed?.setDevice(id);
  };

  // The server's key, asked for once; a failed request is asked again next time.
  let serverKey: Promise<Uint8Array<ArrayBuffer> | null> | null = null;
  const vapidKey = () => {
    serverKey ??= request<{ publicKey: string | null }>('GET', '/push/vapid-public-key').then(
      ({ publicKey }) => (publicKey ? keyBytes(publicKey) : null),
      (error: unknown) => {
        serverKey = null;
        throw error;
      },
    );
    return serverKey;
  };

  const currentSubscription = async () => {
    const registration = await navigator.serviceWorker.getRegistration(scope);
    return (await registration?.pushManager.getSubscription()) ?? null;
  };

  return {
    isSupported: isPushSupported,
    state: async () => {
      if (!isPushSupported()) return { subscribed: false, permission: 'unsupported' };
      const permission = Notification.permission;
      const subscription = await currentSubscription();
      if (!subscription) return { subscribed: false, permission };
      // A subscription another push provider made with its own key never gets this server's
      // pushes, so it reads as not subscribed and enable() replaces it. Without an answer from
      // the server, the browser's own view stands.
      const key = await vapidKey().catch(() => undefined);
      if (key === undefined) return { subscribed: true, permission };
      return {
        subscribed: key !== null && sameKey(subscription.options.applicationServerKey, key),
        permission,
      };
    },
    enable: async () => {
      if (!isPushSupported()) throw new Error('this browser does not support web push');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('notification permission was not granted');

      const applicationServerKey = await vapidKey();
      if (!applicationServerKey) throw new Error('web push is not configured on the server');

      const registration = await navigator.serviceWorker.register(
        options.serviceWorkerPath ?? '/sw.js',
        { scope, type: options.serviceWorkerType },
      );
      let subscription = await registration.pushManager.getSubscription();
      // A subscription made with another key can never receive this server's pushes.
      if (
        subscription &&
        !sameKey(subscription.options.applicationServerKey, applicationServerKey)
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      const created = !subscription;
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const { endpoint, keys } = subscription.toJSON();
      if (!endpoint || !keys?.p256dh || !keys.auth) {
        throw new Error('the browser returned an incomplete push subscription');
      }
      try {
        await request('POST', '/push/subscriptions', {
          endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        });
      } catch (error) {
        // The server refused this browser (allowPush, say): a subscription it made just now
        // would only read as subscribed while nothing reaches it.
        if (created) await subscription.unsubscribe().catch(() => false);
        throw error;
      }
    },
    disable: async () => {
      if (!isPushSupported()) return;
      const subscription = await currentSubscription();
      if (!subscription) return;
      await request('DELETE', '/push/subscriptions', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    },
    registerDevice: async (device, { feedWhileOpen = false } = {}) => {
      const { id } = await request<{ id: string }>('POST', '/push/subscriptions', device);
      if (feedWhileOpen) link(device.deviceToken, id);
      else if (linkedToken === device.deviceToken) link(null, null);
      return { id };
    },
    unregisterDevice: async (deviceToken) => {
      await request('DELETE', '/push/subscriptions', { deviceToken });
      if (linkedToken === deviceToken) link(null, null);
    },
  };
};
