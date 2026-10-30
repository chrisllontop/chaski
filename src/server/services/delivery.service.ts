import { and, eq, sql } from 'drizzle-orm';
import { ChaskiError, isChaskiError, isRetryableChaskiError } from '../../contract/errors';
import { deliveries } from '../db/schema';
import { DeliveryError } from '../lib/errors';
import type { DeliveryMessage } from '../types';
import { CHANNEL_DEFS } from './adapters/registry';
import type { DeliveryRow } from './adapters/types';
import { BaseService } from './base.service';
import { ChannelService } from './channel.service';

export type ProcessOutcome =
  | { status: 'sent' }
  | { status: 'failed' }
  | { status: 'ack' }
  | { status: 'held' }
  | { status: 'retry'; delaySeconds: number };

const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 3600;

export const backoffSeconds = (attempts: number): number => {
  const exponential = Math.min(2 ** attempts * BASE_DELAY_SECONDS, MAX_DELAY_SECONDS);
  const jitter = Math.floor(Math.random() * exponential * 0.3);
  return exponential + jitter;
};

export class DeliveryService extends BaseService {
  protected static override name = 'delivery';

  // Queues are at-least-once: the pending-status check on entry plus explicit
  // ack turns duplicate deliveries into no-ops.
  static process = async (message: DeliveryMessage): Promise<ProcessOutcome> => {
    const delivery = await DeliveryService.client.deliveries.findFirst({
      where: { id: message.deliveryId },
    });
    if (!delivery) {
      DeliveryService.log.error('row missing for message', undefined, {
        deliveryId: message.deliveryId,
      });
      return { status: 'ack' };
    }
    if (delivery.status !== 'pending') {
      return { status: 'ack' };
    }
    if (await ChannelService.isPaused(delivery.channel)) {
      await DeliveryService.client.deliveries.update({
        where: { id: delivery.id },
        data: { status: 'held' },
      });
      return { status: 'held' };
    }

    const notification = await DeliveryService.client.notifications.findFirst({
      where: { id: delivery.notificationId },
    });
    if (!notification) {
      await DeliveryService.markFailed(
        delivery.id,
        'missing_notification',
        'notification row missing',
      );
      return { status: 'failed' };
    }

    const definition = CHANNEL_DEFS[delivery.channel as keyof typeof CHANNEL_DEFS];
    if (!definition) {
      await DeliveryService.markFailed(
        delivery.id,
        'channel_not_available',
        `no adapter for channel '${delivery.channel}'`,
      );
      return { status: 'failed' };
    }

    // Every call to the channel is an attempt, whatever it ends in; the
    // failures above never reached one.
    const attempts = delivery.attempts + 1;
    // workerd advances the clock only across I/O, which the provider call is.
    const startedAt = Date.now();
    try {
      const result = await definition.deliver({ delivery, notification });
      await DeliveryService.client.deliveries.update({
        where: { id: delivery.id },
        data: {
          status: 'sent',
          attempts,
          providerMs: Date.now() - startedAt,
          providerMessageId: result.providerMessageId ?? null,
          sentAt: new Date(),
          lastError: null,
          errorCode: null,
        },
      });
      return { status: 'sent' };
    } catch (error) {
      const providerMs = Date.now() - startedAt;
      const classified = DeliveryService.classify(error);
      if (classified.permanent) {
        await DeliveryService.markFailed(delivery.id, classified.code, classified.message, {
          attempts,
          providerMs,
        });
        return { status: 'failed' };
      }
      await DeliveryService.client.deliveries.update({
        where: { id: delivery.id },
        data: {
          attempts,
          providerMs,
          lastError: classified.message,
          errorCode: classified.code,
        },
      });
      return { status: 'retry', delaySeconds: backoffSeconds(attempts) };
    }
  };

  /** Delivers now, for a caller waiting on the result, and returns the delivery as it ends. */
  static deliverInline = async (message: DeliveryMessage): Promise<DeliveryRow> => {
    const outcome = await DeliveryService.process(message);
    // No queue message stands behind it, and the person waiting decides whether to try again,
    // so a failure the queue would retry is final here; the dashboard can still replay it.
    if (outcome.status === 'retry') {
      await DeliveryService.client.deliveries.update({
        where: { id: message.deliveryId },
        data: { status: 'failed' },
      });
    }
    const delivery = await DeliveryService.client.deliveries.findFirst({
      where: { id: message.deliveryId },
    });
    if (!delivery) throw new ChaskiError('internal', `delivery '${message.deliveryId}' vanished`);
    return delivery;
  };

  // Fired by the public tracking pixel. Unknown ids are a silent no-op (the
  // pixel must always render). An open is a read receipt, not a delivery state:
  // it freezes openedAt on the first open and leaves status and updatedAt
  // alone, so metrics windowed on updatedAt never move an old delivery into
  // the period it was opened in.
  static markOpened = async (deliveryId: string): Promise<boolean> => {
    const result = await DeliveryService.db
      .update(deliveries)
      .set({
        openedAt: sql`COALESCE(${deliveries.openedAt}, ${sql.param(new Date(), deliveries.openedAt)})`,
      })
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.channel, 'email')));
    return result.meta.changes > 0;
  };

  static markDead = async (deliveryId: string): Promise<void> => {
    await DeliveryService.client.deliveries.update({
      where: { id: deliveryId },
      data: { status: 'dead' },
    });
  };

  private static markFailed = async (
    deliveryId: string,
    errorCode: string,
    message: string,
    attempt?: { attempts: number; providerMs: number },
  ): Promise<void> => {
    await DeliveryService.client.deliveries.update({
      where: { id: deliveryId },
      data: { status: 'failed', errorCode, lastError: message, ...attempt },
    });
  };

  private static classify = (
    error: unknown,
  ): { permanent: boolean; code: string; message: string } => {
    if (error instanceof DeliveryError) {
      return { permanent: error.permanent, code: error.errorCode, message: error.message };
    }
    // A template Liquid rejects, or a config someone has to fix, fails the same way next time.
    if (isChaskiError(error)) {
      return {
        permanent: !isRetryableChaskiError(error),
        code: error.code,
        message: error.message,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { permanent: false, code: 'unknown', message };
  };
}
