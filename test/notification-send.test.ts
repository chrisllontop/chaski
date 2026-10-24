import { describe, expect, it } from 'vitest';
import { ChaskiError } from '../src';
import { getClient } from '../src/server/db';
import { NotificationService } from '../src/server/services/notification.service';
import { queuedMessages, recipient, seedTemplate, seedTemplateType } from './helpers';

describe('NotificationService.send', () => {
  it('rejects invalid requests with a validation error', async () => {
    await expect(NotificationService.send({ type: 'x', recipient: {} })).rejects.toThrowError(
      ChaskiError,
    );
  });

  it('rejects explicit channels the host has not configured', async () => {
    await seedTemplateType('payment_received');
    await expect(
      NotificationService.send({
        type: 'payment_received',
        recipient: recipient(),
        channels: ['email', 'push'],
      }),
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'channels not configured: push',
    });
  });

  it('rejects types with no registered template', async () => {
    await expect(
      NotificationService.send({ type: 'type_without_template', recipient: recipient() }),
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining("unknown notification type 'type_without_template'"),
    });
  });

  it('records the notification, its deliveries and the contact', async () => {
    await seedTemplate('payment_received', 'email');

    const result = await NotificationService.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 1500 },
    });

    expect(result).toMatchObject({ replayed: false, outcome: 'delivered' });
    expect(result.deliveries).toEqual([
      expect.objectContaining({ channel: 'email', status: 'pending' }),
    ]);
    expect(queuedMessages()).toEqual([
      expect.objectContaining({ kind: 'chaski.delivery', channel: 'email' }),
    ]);
    const stored = await getClient().notifications.findFirst({
      where: { id: result.notificationId },
    });
    expect(stored?.type).toBe('payment_received');
    expect(JSON.parse(stored?.payload ?? '{}')).toEqual({ amount: 1500 });
    const contact = await getClient().contacts.findFirst({ where: { recipientId: 'user_1' } });
    expect(contact?.email).toBe('ana@example.com');
  });

  it('replays by idempotencyKey, returning the original result', async () => {
    await seedTemplateType('payment_received');

    const first = await NotificationService.send({
      type: 'payment_received',
      recipient: recipient(),
      idempotencyKey: 'invoice-1:reminder',
    });
    const second = await NotificationService.send({
      type: 'payment_received',
      recipient: recipient(),
      idempotencyKey: 'invoice-1:reminder',
    });

    expect(second.replayed).toBe(true);
    expect(second.notificationId).toBe(first.notificationId);
    const rows = await getClient().notifications.findMany({
      where: { idempotencyKey: 'invoice-1:reminder' },
    });
    expect(rows).toHaveLength(1);
  });

  it('merges contact fields instead of clearing absent ones', async () => {
    await seedTemplateType('payment_received');

    await NotificationService.send({
      type: 'payment_received',
      recipient: { id: 'user_9', email: 'x@y.com', phone: '+525511111111' },
    });
    await NotificationService.send({
      type: 'payment_received',
      recipient: { id: 'user_9', email: 'new@y.com' },
    });

    const contact = await getClient().contacts.findFirst({ where: { recipientId: 'user_9' } });
    expect(contact?.email).toBe('new@y.com');
    expect(contact?.phoneE164).toBe('+525511111111');
  });

  it('records a skip with its reason when the template has no channel content', async () => {
    await seedTemplateType('type_without_content');

    const result = await NotificationService.send({
      type: 'type_without_content',
      recipient: recipient(),
    });

    expect(result.outcome).toBe('undeliverable');
    expect(result.deliveries).toEqual([
      expect.objectContaining({ channel: 'email', status: 'skipped', reason: 'no_template' }),
    ]);
    expect(queuedMessages()).toEqual([]);
  });
});
