import { Hono } from 'hono';
import {
  type ChaskiConfig,
  type ChaskiFeed,
  createChaski,
  type DeliveryMessage,
  type SendEmailBinding,
} from '../../src';

export type FixtureEnv = {
  CHASKI_PUBLIC_URL: string;
  CHASKI_DRY_RUN: string;
  CHASKI_DB: D1Database;
  CHASKI_QUEUE: Queue<DeliveryMessage>;
  CHASKI_EMAIL: SendEmailBinding;
  CHASKI_ATTACHMENTS: R2Bucket;
  CHASKI_FEED: DurableObjectNamespace<ChaskiFeed>;
};

export const fixtureConfig = (env: FixtureEnv): ChaskiConfig => ({
  publicUrl: env.CHASKI_PUBLIC_URL,
  bindings: {
    db: env.CHASKI_DB,
    queue: env.CHASKI_QUEUE,
    email: env.CHASKI_EMAIL,
    attachments: env.CHASKI_ATTACHMENTS,
    feed: env.CHASKI_FEED,
  },
  channels: {
    email: { from: 'notifications@host.test', fromName: 'Fixture host' },
    in_app: {},
  },
  dryRun: env.CHASKI_DRY_RUN === 'true',
});

// The host's main module re-exports chaski's classes so its bindings can find them.
export { ChaskiFeed } from '../../src';

export const chaski = createChaski(fixtureConfig);

// Tests pick the authorize verdict per request; the browser gets the default and sees the dashboard.
const dashboard = chaski.routes({
  dashboard: {
    authorize: (c) => {
      const verdict = c.req.header('x-fixture-authorize');
      if (verdict === 'deny') {
        return false;
      }
      if (verdict === 'redirect') {
        return c.redirect('/login', 302);
      }
      return true;
    },
  },
});

const app = new Hono()
  .get('/', (c) => c.text('Host home'))
  .route('/chaski', dashboard)
  .route('/admin', new Hono().route('/notifications', dashboard));

export default {
  fetch: app.fetch,
  queue: async (batch, env, ctx) => {
    await chaski.queue(batch, env, ctx);
  },
} satisfies ExportedHandler<FixtureEnv>;
