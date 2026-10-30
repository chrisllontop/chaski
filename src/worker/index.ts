import type { ChaskiEnv } from '../server/config';
import { handleQueueBatch } from '../server/consumer';
import { ready } from '../server/migrations';
import { dashboard } from '../server/routes';
import type { DeliveryMessage } from '../server/types';

export type { ChaskiEnv } from '../server/config';
export { ChaskiEvents } from '../server/durable/events';
export { ChaskiFeed } from '../server/durable/feed';
export { ChaskiEntrypoint } from '../server/entrypoint';
export type {
  DeliveryMessage,
  EmailAttachment,
  ScheduleParams,
  SendEmailBinding,
} from '../server/types';
export { ChaskiScheduler } from '../server/workflows/scheduler';

const app = dashboard();

/** The Chaski Worker: its main module re-exports this and the four classes above. */
export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  queue: async (batch) => {
    await ready();
    await handleQueueBatch(batch);
  },
} satisfies ExportedHandler<ChaskiEnv, DeliveryMessage>;
