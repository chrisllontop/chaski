import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChaskiError } from '../src';
import { getClient } from '../src/server/db';
import { NotificationService } from '../src/server/services/notification.service';
import { queuedMessages, recipient, seedTemplate, stubEmail } from './helpers';

const reset = (extra: Record<string, unknown> = {}) =>
  NotificationService.send({
    type: 'password_reset',
    recipient: recipient(),
    payload: { amount: 'link' },
    channels: ['email'],
    transactional: true,
    inline: true,
    ...extra,
  });

// Email Service throws errors with a structured code.
const providerError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const emailDelivery = () => getClient().deliveries.findFirst({ where: { channel: 'email' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inline sends', () => {
  it('delivers the email within the call instead of queueing it', async () => {
    await seedTemplate('password_reset', 'email');
    const sent = stubEmail();

    const result = await reset();

    expect(result).toMatchObject({
      outcome: 'delivered',
      deliveries: [expect.objectContaining({ channel: 'email', status: 'sent' })],
    });
    expect(sent).toEqual([expect.objectContaining({ to: 'ana@example.com' })]);
    expect(queuedMessages()).toEqual([]);
    expect(await emailDelivery()).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('throws when the provider refuses the email, and records the failure', async () => {
    await seedTemplate('password_reset', 'email');
    stubEmail(async () => {
      throw providerError('E_RECIPIENT_SUPPRESSED', 'the recipient is suppressed');
    });

    const error = await reset().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: 'ChaskiError',
      code: 'delivery_failed',
      message: expect.stringContaining('the recipient is suppressed (recipient_suppressed'),
    });
    expect(await emailDelivery()).toMatchObject({
      status: 'failed',
      errorCode: 'recipient_suppressed',
      attempts: 1,
    });
    expect(queuedMessages()).toEqual([]);
  });

  // The queue would retry a network failure; here the person waiting decides.
  it('leaves a failure the queue would retry to the caller', async () => {
    await seedTemplate('password_reset', 'email');
    stubEmail(async () => {
      throw new Error('connection reset');
    });

    await expect(reset()).rejects.toMatchObject({ code: 'delivery_failed' });

    expect(await emailDelivery()).toMatchObject({ status: 'failed', errorCode: 'provider_error' });
    expect(queuedMessages()).toEqual([]);
  });

  it('tries a failed email again under the same key, and never sends it twice', async () => {
    await seedTemplate('password_reset', 'email');
    let failing = true;
    const sent = stubEmail(async () => {
      if (failing) throw new Error('connection reset');
      return { messageId: 'msg_2' };
    });

    await expect(reset({ idempotencyKey: 'reset:1' })).rejects.toMatchObject({
      code: 'delivery_failed',
    });
    failing = false;
    const retried = await reset({ idempotencyKey: 'reset:1' });
    const replayed = await reset({ idempotencyKey: 'reset:1' });

    expect(retried).toMatchObject({
      replayed: true,
      outcome: 'delivered',
      deliveries: [expect.objectContaining({ status: 'sent' })],
    });
    expect(replayed.notificationId).toBe(retried.notificationId);
    expect(sent).toHaveLength(2);
    expect(await getClient().deliveries.count({ where: {} })).toBe(1);
    expect(await emailDelivery()).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('answers a broken template as a validation error', async () => {
    await seedTemplate('password_reset', 'email');
    await getClient().templateChannels.update({
      where: { id: 'tc_password_reset_email' },
      data: { body: '{{ amount | append: }}' },
    });
    stubEmail();

    await expect(reset()).rejects.toMatchObject({ code: 'validation' });
  });

  it('needs one transactional email', async () => {
    await seedTemplate('password_reset', 'email');
    await seedTemplate('password_reset', 'in_app');

    for (const extra of [
      { transactional: false },
      { channels: undefined },
      { channels: ['email', 'in_app'] },
      { channels: ['in_app'] },
    ]) {
      await expect(reset(extra)).rejects.toMatchObject({
        code: 'validation',
        message: expect.stringContaining('an inline send delivers one email'),
      });
    }
    expect(await getClient().notifications.count({ where: {} })).toBe(0);
  });

  it('stores nothing when the email would be skipped', async () => {
    await seedTemplate('password_reset', 'email');

    await expect(reset({ recipient: { id: 'email:no-address' } })).rejects.toMatchObject({
      code: 'validation',
      message: 'the inline email would be skipped: missing_email',
    });
    expect(await getClient().notifications.count({ where: {} })).toBe(0);
  });

  it('keeps the error code across the service binding', async () => {
    await seedTemplate('password_reset', 'email');
    stubEmail(async () => {
      throw providerError('E_SENDER_NOT_VERIFIED', 'the sender is not verified');
    });

    const error = await exports.ChaskiEntrypoint.send({
      type: 'password_reset',
      recipient: recipient(),
      channels: ['email'],
      transactional: true,
      inline: true,
    }).catch((caught: unknown) => caught);

    expect(isChaskiError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'delivery_failed' });
  });
});
