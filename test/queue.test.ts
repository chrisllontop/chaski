import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { DeliveryError } from '../src/server/lib/errors';
import { CHANNEL_DEFS, type ChannelDefinition } from '../src/server/services/adapters/registry';
import { DeliveryService } from '../src/server/services/delivery.service';
import worker, { type DeliveryMessage } from '../src/worker';
import { seedTemplate } from './helpers';

const MESSAGE: DeliveryMessage = {
  deliveryId: 'd_queue',
  notificationId: 'n_queue',
  channel: 'email',
  type: 'payment_received',
  recipientId: 'user_1',
};

// The consumer reads the template before it calls the channel, so the type has one.
const seedDelivery = async (channel = 'email') => {
  await seedTemplate('payment_received', 'email');
  await getClient().notifications.create({
    data: {
      id: 'n_queue',
      recipientId: 'user_1',
      type: 'payment_received',
      payload: '{}',
      contactSnapshot: '{}',
    },
  });
  await getClient().deliveries.create({
    data: { id: 'd_queue', notificationId: 'n_queue', channel, status: 'pending' },
  });
};

const deliveryRow = () => getClient().deliveries.findFirst({ where: { id: 'd_queue' } });

const REAL_EMAIL = CHANNEL_DEFS.email;

// Stands in for a channel so the consumer's retry rules are tested on their own.
const useChannel = (deliver: ChannelDefinition['deliver']) => {
  CHANNEL_DEFS.email = { gate: null, deliver };
};

const consume = async (messages: { attempts: number; body: DeliveryMessage }[]) => {
  const batch = createMessageBatch<DeliveryMessage>(
    'chaski-deliveries',
    messages.map((message, index) => ({ id: `m${index}`, timestamp: new Date(), ...message })),
  );
  // The local QueueResult does not carry retry delays, so the calls are observed directly.
  const retries = batch.messages.map((message) => vi.spyOn(message, 'retry'));
  const ctx = createExecutionContext();
  await worker.queue(batch);
  return { retries, result: await getQueueResult(batch, ctx) };
};

afterEach(() => {
  CHANNEL_DEFS.email = REAL_EMAIL;
  vi.restoreAllMocks();
});

describe('the queue consumer', () => {
  it('acks a delivered message and records the provider id', async () => {
    await seedDelivery();
    useChannel(async () => ({ providerMessageId: 'provider_1' }));

    const { result } = await consume([{ attempts: 1, body: MESSAGE }]);

    expect(result.explicitAcks).toEqual(['m0']);
    expect(await deliveryRow()).toMatchObject({ status: 'sent', providerMessageId: 'provider_1' });
  });

  it('retries a transient failure with exponential backoff', async () => {
    await seedDelivery();
    useChannel(async () => {
      throw new Error('provider timed out');
    });

    const { result, retries } = await consume([{ attempts: 1, body: MESSAGE }]);

    expect(result.retryMessages).toEqual([{ msgId: 'm0' }]);
    const delaySeconds = retries[0]?.mock.calls[0]?.[0]?.delaySeconds ?? 0;
    // Attempt 1 waits 2 × 30 s plus up to 30% jitter.
    expect(delaySeconds).toBeGreaterThanOrEqual(60);
    expect(delaySeconds).toBeLessThanOrEqual(78);
    expect(await deliveryRow()).toMatchObject({
      status: 'pending',
      attempts: 1,
      errorCode: 'unknown',
      lastError: 'provider timed out',
    });
  });

  it('marks the delivery dead on the last attempt', async () => {
    await seedDelivery();
    useChannel(async () => {
      throw new Error('provider timed out');
    });

    await consume([{ attempts: 6, body: MESSAGE }]);

    expect((await deliveryRow())?.status).toBe('dead');
  });

  // The consumer in Chaski's wrangler.jsonc retries 5 times, so the sixth attempt is the last.
  it('keeps the delivery pending before the last attempt', async () => {
    await seedDelivery();
    useChannel(async () => {
      throw new Error('provider timed out');
    });

    await consume([{ attempts: 5, body: MESSAGE }]);

    expect((await deliveryRow())?.status).toBe('pending');
  });

  it('fails a permanent error without retrying', async () => {
    await seedDelivery();
    useChannel(async () => {
      throw new DeliveryError('recipient_rejected', 'mailbox does not exist', { permanent: true });
    });

    const { result } = await consume([{ attempts: 1, body: MESSAGE }]);

    expect(result.explicitAcks).toEqual(['m0']);
    expect(await deliveryRow()).toMatchObject({
      status: 'failed',
      errorCode: 'recipient_rejected',
      attempts: 1,
    });
  });

  it('fails a delivery for a channel nothing can send', async () => {
    await seedDelivery('sms');

    await consume([{ attempts: 1, body: { ...MESSAGE, channel: 'sms' } }]);

    expect(await deliveryRow()).toMatchObject({
      status: 'failed',
      errorCode: 'channel_not_available',
    });
  });

  it('logs an unexpected failure and retries in a minute', async () => {
    const error = vi.spyOn(console, 'error');
    vi.spyOn(DeliveryService, 'process').mockRejectedValue(new Error('database unavailable'));

    const { result, retries } = await consume([{ attempts: 1, body: MESSAGE }]);

    expect(result.retryMessages).toEqual([{ msgId: 'm0' }]);
    expect(retries[0]).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(error).toHaveBeenCalledWith('[chaski:consumer]', 'unexpected failure', {
      deliveryId: 'd_queue',
      channel: 'email',
      attempt: 1,
      err: 'database unavailable',
    });
  });
});
