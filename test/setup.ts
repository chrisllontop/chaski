import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, vi } from 'vitest';

await applyD1Migrations(env.CHASKI_DB, env.TEST_MIGRATIONS);

// Children before parents so foreign keys never block the wipe.
const TABLES = [
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
  // Unit tests drain deliveries themselves (processDeliveries); only the
  // end-to-end test lets the fixture's real queue consumer run.
  vi.spyOn(env.CHASKI_QUEUE, 'sendBatch').mockResolvedValue({} as never);
  vi.spyOn(env.CHASKI_QUEUE, 'send').mockResolvedValue({} as never);
});
