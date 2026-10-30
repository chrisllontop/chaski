import { exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import { userRoutes } from '../../src';
import { api } from '../../src/server/api';
import {
  type ChaskiConfig,
  type ChaskiEnv,
  configFromEnv,
  setConfigure,
} from '../../src/server/config';
import type {
  ChaskiEvents,
  ChaskiFeed,
  DeliveryMessage,
  ScheduleParams,
  SendEmailBinding,
} from '../../src/worker';
import worker from '../../src/worker';
import { seed } from './seed';

// The Chaski Worker as its project declares it, every binding included; the tests and `pnpm dev`
// both run it.
export type FixtureEnv = {
  CHASKI_DB: D1Database;
  CHASKI_QUEUE: Queue<DeliveryMessage>;
  CHASKI_EMAIL: SendEmailBinding;
  CHASKI_ATTACHMENTS: R2Bucket;
  CHASKI_FEED: DurableObjectNamespace<ChaskiFeed>;
  CHASKI_EVENTS: DurableObjectNamespace<ChaskiEvents>;
  CHASKI_SCHEDULER: Workflow<ScheduleParams>;
  CHASKI_ENVIRONMENT?: string;
  CHASKI_PUBLIC_URL?: string;
};

export const fixtureConfig = (env: ChaskiEnv): ChaskiConfig => ({
  ...configFromEnv(env),
  channels: {
    email: { from: 'notifications@host.test', fromName: 'Fixture host' },
    in_app: {},
  },
});

setConfigure(fixtureConfig);

export { ChaskiEntrypoint, ChaskiEvents, ChaskiFeed, ChaskiScheduler } from '../../src/worker';

// An app's routes, in this Worker so one `wrangler dev` serves both. They reach Chaski through the
// loopback binding to ChaskiEntrypoint, the way an app's own service binding would. The signed-in
// user comes from a header here; a real app reads its session.
const notifications = userRoutes({
  chaski: () => exports.ChaskiEntrypoint,
  identify: (c) => c.req.header('x-fixture-user') ?? null,
  allowedOrigins: ['https://frontend.app.test'],
});

// A second inbox for the same signed-in user, shared with their team: its own contact, so its own
// feed, socket and count, and the feed alone, so a browser can't leave the user's own inbox for it.
const teamNotifications = userRoutes({
  chaski: () => exports.ChaskiEntrypoint,
  identify: (c) => {
    const user = c.req.header('x-fixture-user');
    return user ? `team:${user}` : null;
  },
  groups: ['feed'],
});

const app = new Hono<{ Bindings: FixtureEnv }>()
  // Fills the local database for `pnpm dev`, where wrangler keeps every email on disk; only in the
  // local environment, so nothing reaches a provider.
  .post('/dev/seed', async (c) => {
    if (c.env.CHASKI_ENVIRONMENT !== 'local') {
      return c.json({ error: 'not_found', message: 'no such endpoint' }, 404);
    }
    return c.json(await seed(api));
  })
  .route('/app/notifications', notifications)
  .route('/app/team-notifications', teamNotifications);

export default {
  fetch: (request, env, ctx) =>
    /^\/(app|dev)\//.test(new URL(request.url).pathname)
      ? app.fetch(request, env, ctx)
      : worker.fetch(request, env, ctx),
  queue: worker.queue,
} satisfies ExportedHandler<FixtureEnv, DeliveryMessage>;
