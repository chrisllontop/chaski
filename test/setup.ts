import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, vi } from 'vitest';
import { ready } from '../src/server/migrations';
import { useConfig } from './helpers';

await applyD1Migrations(env.CHASKI_DB, env.TEST_MIGRATIONS);

// Children before parents so foreign keys never block the wipe.
const TABLES = [
  'channel_pauses',
  'settings',
  'deliveries',
  'feed_items',
  'notifications',
  'scheduled_notifications',
  'device_tokens',
  'preferences',
  'contacts',
  'template_channels',
  'templates',
];

beforeEach(async () => {
  for (const table of TABLES) {
    await env.CHASKI_DB.prepare(`DELETE FROM ${table}`).run();
  }
  // A test that overrides the config must not leak it into the next one.
  useConfig();
  // The settings the tables held were just wiped, so the config reads none.
  await ready();
  // Unit tests drain deliveries themselves (processDeliveries); only the
  // end-to-end test lets the fixture's real queue consumer run.
  vi.spyOn(env.CHASKI_QUEUE, 'sendBatch').mockResolvedValue({} as never);
  vi.spyOn(env.CHASKI_QUEUE, 'send').mockResolvedValue({} as never);
});
