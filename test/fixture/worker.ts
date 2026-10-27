import { Hono } from 'hono';
import {
  type ChaskiConfig,
  type ChaskiEvents,
  type ChaskiFeed,
  createChaski,
  type DeliveryMessage,
  type ScheduleParams,
  type SendEmailBinding,
} from '../../src';
import { seed } from './seed';

export type FixtureEnv = {
  CHASKI_PUBLIC_URL: string;
  CHASKI_DRY_RUN: string;
  CHASKI_DB: D1Database;
  CHASKI_QUEUE: Queue<DeliveryMessage>;
  CHASKI_EMAIL: SendEmailBinding;
  CHASKI_ATTACHMENTS: R2Bucket;
  CHASKI_FEED: DurableObjectNamespace<ChaskiFeed>;
  CHASKI_EVENTS: DurableObjectNamespace<ChaskiEvents>;
  CHASKI_SCHEDULER: Workflow<ScheduleParams>;
};

export const fixtureConfig = (env: FixtureEnv): ChaskiConfig => ({
  publicUrl: env.CHASKI_PUBLIC_URL,
  bindings: {
    db: env.CHASKI_DB,
    queue: env.CHASKI_QUEUE,
    email: env.CHASKI_EMAIL,
    attachments: env.CHASKI_ATTACHMENTS,
    feed: env.CHASKI_FEED,
    events: env.CHASKI_EVENTS,
    scheduler: env.CHASKI_SCHEDULER,
  },
  channels: {
    email: { from: 'notifications@host.test', fromName: 'Fixture host' },
    in_app: {},
  },
  dryRun: env.CHASKI_DRY_RUN === 'true',
});

// The host's main module re-exports Chaski's classes so its bindings, and the
// service bindings of its other Workers, can find them.
export { ChaskiEntrypoint, ChaskiEvents, ChaskiFeed, ChaskiScheduler } from '../../src';

export const chaski = createChaski(fixtureConfig);

// Tests pick the authorize verdict per request; the browser gets the default and sees the dashboard.
const dashboard = chaski.routes({
  dashboard: {
    authorize: (c) => {
      const verdict = c.req.header('x-fixture-authorize');
      if (verdict === 'deny') {
        return null;
      }
      if (verdict === 'redirect') {
        return c.redirect('/login', 302);
      }
      return { id: c.req.header('x-fixture-actor') ?? 'admin@host.test', name: 'Fixture admin' };
    },
  },
});

// The signed-in user comes from a header here; a real host reads its session.
const notifications = chaski.userRoutes({
  identify: (c) => c.req.header('x-fixture-user') ?? null,
  allowedOrigins: ['https://frontend.host.test'],
});

const app = new Hono<{ Bindings: FixtureEnv }>()
  .get('/', (c) => c.text('Host home'))
  // Fills the local database for `pnpm dev`; only in dry run, so nothing reaches a provider.
  .post('/dev/seed', async (c) => {
    if (c.env.CHASKI_DRY_RUN !== 'true')
      return c.json({ error: 'not_found', message: 'no such endpoint' }, 404);
    return c.json(await seed(chaski));
  })
  .route('/me/notifications', notifications)
  .route('/chaski', dashboard)
  .route('/admin', new Hono().route('/notifications', dashboard));

export default {
  fetch: app.fetch,
  queue: async (batch, env, ctx) => {
    await chaski.queue(batch, env, ctx);
  },
} satisfies ExportedHandler<FixtureEnv>;
