import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { NotificationService } from '../src/server/services/notification.service';
import { chaski, fixtureConfig } from './fixture/worker';
import { processDeliveries, recipient, seedTemplate, useConfig } from './helpers';

const sendInApp = async (amount = 1500, recipientId = 'user_1') => {
  const result = await NotificationService.send({
    type: 'payment_received',
    recipient: recipient(recipientId),
    payload: { amount },
    channels: ['in_app'],
  });
  await processDeliveries(result.notificationId);
  return result;
};

const openFeedSocket = async (recipientId: string) => {
  const stub = env.CHASKI_FEED.get(env.CHASKI_FEED.idFromName(recipientId));
  const response = await stub.fetch('https://feed.internal/', {
    headers: { upgrade: 'websocket' },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error('the feed did not upgrade');
  socket.accept();
  const received: unknown[] = [];
  socket.addEventListener('message', (event) => {
    received.push(JSON.parse(String(event.data)));
  });
  return { socket, received };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('in-app channel', () => {
  it('stores the rendered item in the recipient feed', async () => {
    await seedTemplate('payment_received', 'in_app');

    const result = await sendInApp();

    const page = await chaski.feed.list({ recipientId: 'user_1' });
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          type: 'payment_received',
          title: 'Hello Ana',
          body: 'Amount: 1500',
          href: '/payments/1500',
          readAt: null,
        }),
      ],
      nextCursor: null,
    });
    const delivery = await getClient().deliveries.findFirst({
      where: { notificationId: result.notificationId, channel: 'in_app' },
    });
    expect(delivery).toMatchObject({ status: 'sent', providerMessageId: page.items[0]?.id });
  });

  it('hands the item its notification id and the send’s data, in the list and the event', async () => {
    await seedTemplate('payment_received', 'in_app');
    const ana = await openFeedSocket('user_1');

    const result = await NotificationService.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 1500 },
      channels: ['in_app'],
      data: { eventId: 'evt_42', kind: 'payment' },
    });
    await processDeliveries(result.notificationId);

    const [item] = (await chaski.feed.list({ recipientId: 'user_1' })).items;
    expect(item).toMatchObject({
      notificationId: result.notificationId,
      data: { eventId: 'evt_42', kind: 'payment' },
    });
    await vi.waitFor(() => expect(ana.received).toEqual([{ type: 'feed_item.created', item }]));
    ana.socket.close();
  });

  it('refuses data a push couldn’t carry as is', async () => {
    await seedTemplate('payment_received', 'in_app');
    const send = (data: Record<string, string>) =>
      NotificationService.send({
        type: 'payment_received',
        recipient: recipient(),
        channels: ['in_app'],
        data,
      });

    await expect(send({ href: '/elsewhere' })).rejects.toMatchObject({ code: 'validation' });
    await expect(send({ google_sent: '1' })).rejects.toMatchObject({ code: 'validation' });
    await expect(send({ 'event-id': '1' })).rejects.toMatchObject({ code: 'validation' });
    await expect(send({ count: 3 as unknown as string })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('signals open feed sockets of that recipient only', async () => {
    await seedTemplate('payment_received', 'in_app');
    const ana = await openFeedSocket('user_1');
    const other = await openFeedSocket('user_2');

    await sendInApp();

    const [item] = (await chaski.feed.list({ recipientId: 'user_1' })).items;
    await vi.waitFor(() => expect(ana.received).toEqual([{ type: 'feed_item.created', item }]));
    expect(other.received).toEqual([]);
    ana.socket.close();
    other.socket.close();
  });

  // Without this signal, another tab or device of the same recipient keeps counting what was read.
  it('signals reads to the open feed sockets of that recipient', async () => {
    await seedTemplate('payment_received', 'in_app');
    await sendInApp(1);
    await sendInApp(2);
    const ana = await openFeedSocket('user_1');
    const [first] = (await chaski.feed.list({ recipientId: 'user_1' })).items;

    await chaski.feed.markRead({ recipientId: 'user_1', ids: [first?.id ?? ''] });
    await chaski.feed.markRead({ recipientId: 'user_1' });
    await chaski.feed.markRead({ recipientId: 'user_1' });

    await vi.waitFor(() =>
      expect(ana.received).toEqual([
        { type: 'feed_item.read', ids: [first?.id] },
        { type: 'feed_item.read', before: expect.any(String) },
      ]),
    );
    ana.socket.close();
  });

  it('keeps the delivery sent when the realtime signal fails', async () => {
    await seedTemplate('payment_received', 'in_app');
    const onError = vi.fn();
    const config = fixtureConfig(env);
    const broken = {
      idFromName: () => {
        throw new Error('feed namespace unavailable');
      },
    } as unknown as DurableObjectNamespace<never>;
    useConfig({ bindings: { ...config.bindings, feed: broken }, onError });

    const result = await sendInApp();

    const delivery = await getClient().deliveries.findFirst({
      where: { notificationId: result.notificationId, channel: 'in_app' },
    });
    expect(delivery?.status).toBe('sent');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'feed namespace unavailable' }),
      expect.objectContaining({ source: 'feed', channel: 'in_app' }),
    );
  });

  it('answers a plain request to the feed object with 426', async () => {
    const stub = env.CHASKI_FEED.get(env.CHASKI_FEED.idFromName('user_1'));

    const response = await stub.fetch('https://feed.internal/');

    expect(response.status).toBe(426);
  });
});

describe('feed API', () => {
  it('pages through the feed newest first without gaps or repeats', async () => {
    await seedTemplate('payment_received', 'in_app');
    for (const amount of [1, 2, 3, 4, 5]) await sendInApp(amount);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await chaski.feed.list({ recipientId: 'user_1', limit: 2, cursor });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.body));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('marks items read by id and counts what is left', async () => {
    await seedTemplate('payment_received', 'in_app');
    await sendInApp(1);
    await sendInApp(2);
    const [first] = (await chaski.feed.list({ recipientId: 'user_1' })).items;

    expect(await chaski.feed.markRead({ recipientId: 'user_1', ids: [first?.id ?? ''] })).toEqual({
      marked: 1,
    });
    expect(await chaski.feed.unreadCount('user_1')).toEqual({ unread: 1 });
    const unread = await chaski.feed.list({ recipientId: 'user_1', unreadOnly: true });
    expect(unread.items.map((item) => item.id)).not.toContain(first?.id);
  });

  it('marks everything up to an instant, or the whole feed', async () => {
    await seedTemplate('payment_received', 'in_app');
    await sendInApp(1);

    expect(
      await chaski.feed.markRead({ recipientId: 'user_1', before: '2000-01-01T00:00:00Z' }),
    ).toEqual({ marked: 0 });
    expect(await chaski.feed.markRead({ recipientId: 'user_1' })).toEqual({ marked: 1 });
    expect(await chaski.feed.unreadCount('user_1')).toEqual({ unread: 0 });
  });

  it('does not touch another recipient feed', async () => {
    await seedTemplate('payment_received', 'in_app');
    await sendInApp(1, 'user_2');

    expect(await chaski.feed.markRead({ recipientId: 'user_1' })).toEqual({ marked: 0 });
    expect(await chaski.feed.unreadCount('user_2')).toEqual({ unread: 1 });
  });

  it('rejects a malformed cursor and a timestamp without an offset', async () => {
    await expect(
      chaski.feed.list({ recipientId: 'user_1', cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ code: 'validation', message: 'malformed feed cursor' });
    await expect(
      chaski.feed.markRead({ recipientId: 'user_1', before: '2026-01-01T00:00:00' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
