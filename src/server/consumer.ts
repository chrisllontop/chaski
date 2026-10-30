import { publishAdminEvents } from './lib/admin-events';
import { logger } from './lib/log';
import { DeliveryService } from './services/delivery.service';
import type { DeliveryMessage } from './types';

const log = logger('consumer');

const LOG_LINES = {
  sent: 'delivery sent',
  held: 'delivery held',
  ack: 'delivery skipped',
} as const;

// The queue delivers a message at most max_retries + 1 times; the consumer in Chaski's
// wrangler.jsonc sets max_retries to 5.
const MAX_ATTEMPTS = 6;

export const handleQueueBatch = async (batch: MessageBatch<DeliveryMessage>): Promise<void> => {
  for (const message of batch.messages) {
    await processDelivery(message);
  }
  await publishAdminEvents(['deliveries', 'metrics']);
};

const processDelivery = async (message: Message<DeliveryMessage>): Promise<void> => {
  const { deliveryId, notificationId, channel } = message.body;
  // A retryable failure on the final attempt is marked dead before the runtime moves it to the
  // DLQ, so the row never stays pending.
  try {
    const outcome = await DeliveryService.process(message.body);
    if (outcome.status === 'retry') {
      if (message.attempts >= MAX_ATTEMPTS) {
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
    log.error('unexpected failure', error, { deliveryId, channel, attempt: message.attempts });
    message.retry({ delaySeconds: 60 });
  }
};
