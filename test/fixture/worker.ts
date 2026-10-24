import { Hono } from 'hono';
import { type ChaskiConfig, createChaski, type DeliveryMessage } from '../../src';

export type FixtureEnv = {
  CHASKI_DB: D1Database;
  CHASKI_QUEUE: Queue<DeliveryMessage>;
};

export const fixtureConfig = (env: FixtureEnv): ChaskiConfig => ({
  bindings: { db: env.CHASKI_DB, queue: env.CHASKI_QUEUE },
});

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
