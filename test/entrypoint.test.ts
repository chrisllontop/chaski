import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { isChaskiError } from '../src';
import { getClient } from '../src/server/db';
import { processDeliveries, queuedMessages, recipient, seedTemplate } from './helpers';

// exports.ChaskiEntrypoint is a loopback service binding to the fixture host,
// so every call here crosses real RPC serialization, as another Worker's would.
const chaski = exports.ChaskiEntrypoint;

describe('ChaskiEntrypoint', () => {
  it('sends through the service binding', async () => {
    await seedTemplate('payment_received', 'in_app');

    const result = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 1500 },
    });

    expect(result).toMatchObject({ replayed: false, outcome: 'delivered' });
    expect(queuedMessages()).toEqual([
      expect.objectContaining({ kind: 'chaski.delivery', channel: 'in_app' }),
    ]);
    const stored = await getClient().notifications.findFirst({
      where: { id: result.notificationId },
    });
    expect(stored?.type).toBe('payment_received');
  });

  it('reaches the feed, preferences, devices and schedules through their groups', async () => {
    await seedTemplate('payment_received', 'in_app');
    const { notificationId } = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 1500 },
    });
    await processDeliveries(notificationId);

    expect(await chaski.feed().unreadCount('user_1')).toEqual({ unread: 1 });
    const page = await chaski.feed().list({ recipientId: 'user_1' });
    expect(page.items).toEqual([expect.objectContaining({ title: 'Hello Ana' })]);
    expect(await chaski.feed().markRead({ recipientId: 'user_1' })).toEqual({ marked: 1 });

    await chaski.preferences().set('user_1', { mutedTypes: ['payment_received'] });
    expect(await chaski.preferences().get('user_1')).toMatchObject({
      mutedTypes: ['payment_received'],
    });
    expect(await chaski.push().vapidPublicKey()).toEqual({ publicKey: null });
    expect(await chaski.schedules().list({ recipientId: 'user_1' })).toEqual([]);
  });

  it('keeps the error code across the binding', async () => {
    const error = await chaski
      .send({ type: 'type_without_template', recipient: recipient() })
      .catch((caught: unknown) => caught);

    expect(isChaskiError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'validation',
      message: expect.stringContaining("unknown notification type 'type_without_template'"),
    });
  });
});
