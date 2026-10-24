import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChaski, type DeliveryMessage } from '../src';
import { getClient } from '../src/server/db';
import { DeliveryError } from '../src/server/lib/errors';
import { CHANNEL_DEFS, type ChannelDefinition } from '../src/server/services/adapters/registry';
import { DeliveryService } from '../src/server/services/delivery.service';
import { chaski, fixtureConfig } from './fixture/worker';

const MESSAGE: DeliveryMessage = {
  kind: 'chaski.delivery',
  deliveryId: 'd_queue',
  notificationId: 'n_queue',
  channel: 'email',
  type: 'payment_received',
  recipientId: 'user_1',
};

const seedDelivery = async (channel = 'email') => {
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

// Stands in for a channel so the consumer's retry rules are tested on their own.
const useChannel = (deliver: ChannelDefinition['deliver']) => {
  CHANNEL_DEFS.email = { gate: null, deliver };
};

const consume = async (messages: { attempts: number; body: unknown }[]) => {
  const batch = createMessageBatch(
    'chaski-deliveries',
    messages.map((message, index) => ({ id: `m${index}`, timestamp: new Date(), ...message })),
  );
  // The local QueueResult does not carry retry delays, so the calls are observed directly.
  const retries = batch.messages.map((message) => vi.spyOn(message, 'retry'));
  const ctx = createExecutionContext();
  const handled = await chaski.queue(batch, env, ctx);
  return { handled, retries, result: await getQueueResult(batch, ctx) };
};

afterEach(() => {
  delete CHANNEL_DEFS.email;
  vi.restoreAllMocks();
});

describe('chaski.queue', () => {
  it('leaves a batch from another queue untouched', async () => {
    const { handled, result } = await consume([{ attempts: 1, body: { invoiceId: 'inv_1' } }]);

    expect(handled).toBe(false);
    expect(result).toMatchObject({ explicitAcks: [], retryMessages: [], ackAll: false });
  });

  it('leaves a batch that mixes chaski and foreign messages untouched', async () => {
    const { handled, result } = await consume([
      { attempts: 1, body: MESSAGE },
      { attempts: 1, body: 'foreign' },
    ]);

    expect(handled).toBe(false);
    expect(result.explicitAcks).toEqual([]);
  });

  it('acks a delivered message and records the provider id', async () => {
    await seedDelivery();
    useChannel(async () => ({ providerMessageId: 'provider_1' }));

    const { handled, result } = await consume([{ attempts: 1, body: MESSAGE }]);

    expect(handled).toBe(true);
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

  it('counts attempts from the host maxRetries', async () => {
    createChaski(() => ({ ...fixtureConfig(env), maxRetries: 1 }));
    await seedDelivery();
    useChannel(async () => {
      throw new Error('provider timed out');
    });

    await consume([{ attempts: 2, body: MESSAGE }]);

    expect((await deliveryRow())?.status).toBe('dead');
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
      attempts: 0,
    });
  });

  it('fails a delivery for a channel nothing can send', async () => {
    await seedDelivery('push');

    await consume([{ attempts: 1, body: { ...MESSAGE, channel: 'push' } }]);

    expect(await deliveryRow()).toMatchObject({
      status: 'failed',
      errorCode: 'channel_not_available',
    });
  });

  it('reports an unexpected failure to onError and retries in a minute', async () => {
    const onError = vi.fn();
    createChaski(() => ({ ...fixtureConfig(env), onError }));
    const failure = new Error('database unavailable');
    vi.spyOn(DeliveryService, 'process').mockRejectedValue(failure);

    const { result, retries } = await consume([{ attempts: 1, body: MESSAGE }]);

    expect(result.retryMessages).toEqual([{ msgId: 'm0' }]);
    expect(retries[0]).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(onError).toHaveBeenCalledWith(failure, {
      source: 'queue',
      deliveryId: 'd_queue',
      notificationId: 'n_queue',
      channel: 'email',
    });
  });
});
