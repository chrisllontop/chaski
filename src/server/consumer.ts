import { resolveConfig } from './config';
import { publishAdminEvents } from './lib/admin-events';
import { logger } from './lib/log';
import { reportError } from './lib/report-error';
import { DeliveryService } from './services/delivery.service';
import type { DeliveryMessage } from './types';

const log = logger('consumer');

const LOG_LINES = {
  sent: 'delivery sent',
  held: 'delivery held',
  ack: 'delivery skipped',
} as const;

// A batch is Chaski's only when every message carries the delivery kind; a
// shared queue is a host misconfiguration, so a mixed batch is left alone.
export const isChaskiBatch = (
  batch: MessageBatch<unknown>,
): batch is MessageBatch<DeliveryMessage> =>
  batch.messages.length > 0 &&
  batch.messages.every(
    (message) =>
      typeof message.body === 'object' &&
      message.body !== null &&
      (message.body as { kind?: unknown }).kind === 'chaski.delivery',
  );

export const handleQueueBatch = async (batch: MessageBatch<DeliveryMessage>): Promise<void> => {
  for (const message of batch.messages) {
    await processDelivery(message);
  }
  await publishAdminEvents(['deliveries', 'metrics']);
};

const processDelivery = async (message: Message<DeliveryMessage>): Promise<void> => {
  const { deliveryId, notificationId, channel } = message.body;
  // The queue delivers a message at most max_retries + 1 times; a retryable
  // failure on the final attempt is marked dead before the runtime moves it to
  // the DLQ, so the row never stays pending.
  const maxAttempts = resolveConfig().maxRetries + 1;
  try {
    const outcome = await DeliveryService.process(message.body);
    if (outcome.status === 'retry') {
      if (message.attempts >= maxAttempts) {
        await DeliveryService.markDead(deliveryId);
        log.warn('delivery dead-lettered', { deliveryId, channel, attempts: message.attempts });
      } else {
        log.warn('delivery retry', {
          deliveryId,
          channel,
          attempt: message.attempts,
          delaySeconds: outcome.delaySeconds,
        });
      }
      message.retry({ delaySeconds: outcome.delaySeconds });
    } else {
      if (outcome.status === 'failed') {
        log.warn('delivery failed', { deliveryId, channel, attempt: message.attempts });
      } else {
        log.info(LOG_LINES[outcome.status], {
          deliveryId,
          channel,
          notificationId,
        });
      }
      message.ack();
    }
  } catch (error) {
    // Retried per message, so one unexpected failure never retries the whole batch.
    reportError(error, { source: 'queue', deliveryId, notificationId, channel });
    log.error('unexpected failure', error, { deliveryId, channel, attempt: message.attempts });
    message.retry({ delaySeconds: 60 });
  }
};
