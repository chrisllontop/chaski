import { env, exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { AdminSocketEvent } from '../src';
import { publishAdminEvents } from '../src/server/lib/admin-events';
import { chaski, fixtureConfig } from './fixture/worker';
import { api, recipient, seedTemplate, useConfig } from './helpers';

const openEvents = async () => {
  const response = await exports.default.fetch('https://host.test/chaski/api/events', {
    headers: { upgrade: 'websocket', origin: 'https://host.test' },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error(`no upgrade: ${response.status}`);
  socket.accept();
  const received: AdminSocketEvent[] = [];
  socket.addEventListener('message', (event) => {
    received.push(JSON.parse(String(event.data)));
  });
  return { socket, received };
};

// Longer than the hub's flush window, which an earlier test may have opened.
const waitForTopics = (received: AdminSocketEvent[], topics: string[]) =>
  vi.waitFor(
    () => expect(received.flatMap((event) => event.topics)).toEqual(expect.arrayContaining(topics)),
    { timeout: 4_000, interval: 50 },
  );

describe('/api/events', () => {
  it('tells open dashboards which data changed', { timeout: 10_000 }, async () => {
    await seedTemplate('payment_received', 'in_app');
    const { socket, received } = await openEvents();

    await chaski.send({ type: 'payment_received', recipient: recipient() });

    await waitForTopics(received, ['deliveries', 'metrics']);
    expect(received[0]).toEqual({
      type: 'invalidate',
      topics: expect.any(Array),
      at: expect.any(String),
    });
    socket.close();
  });

  // The hub is one instance for every test, so a flush window an earlier test
  // opened may still be running: the burst arrives in one or two messages,
  // never three.
  it('merges a burst of invalidations', { timeout: 10_000 }, async () => {
    const { socket, received } = await openEvents();

    await publishAdminEvents(['templates']);
    await publishAdminEvents(['deliveries']);
    await publishAdminEvents(['metrics']);

    await waitForTopics(received, ['templates', 'deliveries', 'metrics']);
    expect(received.length).toBeLessThan(3);
    socket.close();
  });

  it('signals template changes made through the admin API', { timeout: 10_000 }, async () => {
    const { socket, received } = await openEvents();

    await api('/templates', { method: 'POST', body: JSON.stringify({ type: 'welcome' }) });

    await waitForTopics(received, ['templates']);
    socket.close();
  });

  it('answers a plain request with 426', async () => {
    const response = await api('/events');

    expect(response.status).toBe(426);
  });

  it('is off when the host leaves the events binding out', async () => {
    const config = fixtureConfig(env);
    useConfig({ bindings: { ...config.bindings, events: undefined } });

    const response = await api('/events', { headers: { upgrade: 'websocket' } });

    expect(response.status).toBe(404);
    await expect(publishAdminEvents(['templates'])).resolves.toBeUndefined();
  });
});
