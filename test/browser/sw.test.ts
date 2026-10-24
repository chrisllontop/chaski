import { describe, expect, it, vi } from 'vitest';
import { handlePushEvents, type ServiceWorkerScopeLike } from '../../src/sw';

const scope = (windows: Array<{ focus?: () => Promise<unknown> }> = []) => {
  const listeners: Record<string, (event: never) => void> = {};
  const clients = windows.map((w) => ({
    ...w,
    navigate: vi.fn(async () => {}),
    postMessage: vi.fn(),
  }));
  const fake = {
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners[type] = listener;
    },
    registration: { showNotification: vi.fn(async () => {}) },
    clients: { matchAll: async () => clients, openWindow: vi.fn(async () => {}) },
  };
  handlePushEvents(fake as unknown as ServiceWorkerScopeLike, { icon: '/icon.png' });
  const dispatch = async (type: string, event: object) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]?.({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) } as never);
    await pending;
  };
  return { fake, clients, dispatch };
};

describe('handlePushEvents', () => {
  it('shows the push and tells open windows to refresh', async () => {
    const { fake, clients, dispatch } = scope([{ focus: async () => {} }]);

    await dispatch('push', {
      data: { json: () => ({ title: 'Paid', body: '1500', href: '/payments/1', tag: 'n_1' }) },
    });

    expect(fake.registration.showNotification).toHaveBeenCalledWith('Paid', {
      body: '1500',
      icon: '/icon.png',
      data: { href: '/payments/1' },
      tag: 'n_1',
    });
    expect(clients[0]?.postMessage).toHaveBeenCalledWith({ type: 'chaski:push' });
  });

  it('still shows a push that is not JSON', async () => {
    const { fake, dispatch } = scope();

    await dispatch('push', {
      data: {
        json: () => {
          throw new SyntaxError('not json');
        },
      },
    });

    expect(fake.registration.showNotification).toHaveBeenCalledWith(
      'Notification',
      expect.objectContaining({ data: { href: '/' } }),
    );
  });

  it('takes an open window to the link on click', async () => {
    const focus = vi.fn(async () => {});
    const { fake, clients, dispatch } = scope([{ focus }]);
    const close = vi.fn();

    await dispatch('notificationclick', { notification: { close, data: { href: '/payments/1' } } });

    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(clients[0]?.navigate).toHaveBeenCalledWith('/payments/1');
    expect(fake.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window when none is open', async () => {
    const { fake, dispatch } = scope();

    await dispatch('notificationclick', {
      notification: { close: () => {}, data: { href: '/payments/1' } },
    });

    expect(fake.clients.openWindow).toHaveBeenCalledWith('/payments/1');
  });
});
