import type { PushPayload } from '../contract/contract';

// Structural types for the slice of ServiceWorkerGlobalScope this module
// uses, so it compiles under the DOM lib without the WebWorker one.
type WindowClientLike = {
  focus?: () => Promise<unknown>;
  navigate?: (url: string) => Promise<unknown>;
  postMessage: (message: unknown) => void;
};

type PushEventLike = {
  data?: { json(): unknown } | null;
  waitUntil(promise: Promise<unknown>): void;
};

type NotificationClickEventLike = {
  notification: { close(): void; data?: { href?: string } };
  waitUntil(promise: Promise<unknown>): void;
};

export type ServiceWorkerScopeLike = {
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void;
  addEventListener(
    type: 'notificationclick',
    listener: (event: NotificationClickEventLike) => void,
  ): void;
  registration: {
    showNotification(title: string, options?: Record<string, unknown>): Promise<void>;
  };
  clients: {
    matchAll(options?: {
      type?: string;
      includeUncontrolled?: boolean;
    }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
};

export type PushHandlerOptions = {
  /** Shown when a push arrives without a title. Defaults to `Notification`. */
  defaultTitle?: string;
  /** Defaults to `/favicon.ico`. */
  icon?: string;
  /** Opened on click when the push carries no link. Defaults to `/`. */
  defaultUrl?: string;
  /** Posted to open windows on every push and click, so they refresh their feed. */
  messageType?: string;
};

export const PUSH_MESSAGE_TYPE = 'chaski:push';

/**
 * Shows Chaski's pushes and handles their clicks; call it from the host's
 * service worker: `handlePushEvents(self)`. A click focuses an open window
 * and takes it to the push's link, or opens one.
 */
export const handlePushEvents = (
  scope: ServiceWorkerScopeLike,
  options: PushHandlerOptions = {},
): void => {
  const messageType = options.messageType ?? PUSH_MESSAGE_TYPE;
  const defaultUrl = options.defaultUrl ?? '/';

  const windows = () => scope.clients.matchAll({ type: 'window', includeUncontrolled: true });

  scope.addEventListener('push', (event) => {
    let payload: Partial<PushPayload> = {};
    try {
      payload = (event.data?.json() ?? {}) as Partial<PushPayload>;
    } catch {
      // A push that isn't JSON still shows, with the default title.
    }
    event.waitUntil(
      (async () => {
        await scope.registration.showNotification(
          payload.title ?? options.defaultTitle ?? 'Notification',
          {
            body: payload.body ?? '',
            icon: options.icon ?? '/favicon.ico',
            data: { href: payload.href ?? defaultUrl },
            ...(payload.tag ? { tag: payload.tag } : {}),
          },
        );
        for (const client of await windows()) client.postMessage({ type: messageType });
      })(),
    );
  });

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const href = event.notification.data?.href ?? defaultUrl;
    event.waitUntil(
      (async () => {
        for (const client of await windows()) {
          if (!client.focus) continue;
          await client.focus();
          await client.navigate?.(href);
          client.postMessage({ type: messageType });
          return;
        }
        await scope.clients.openWindow(href);
      })(),
    );
  });
};

export type { PushPayload } from '../contract/contract';
