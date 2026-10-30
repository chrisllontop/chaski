import { env, exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createChaski } from '../src';
import { ensureMigrations, MIGRATIONS } from '../src/server/migrations';
import { TemplateService } from '../src/server/services/template.service';
import { fixtureConfig } from './fixture/worker';
import { useConfig } from './helpers';

describe('migrations', () => {
  it('lists every file the package ships in migrations/', () => {
    expect(MIGRATIONS).toEqual(env.TEST_MIGRATIONS.map((migration) => migration.name));
  });

  it('passes once the host applied every migration', async () => {
    await expect(ensureMigrations(env.CHASKI_DB, 'd1_migrations')).resolves.toBeUndefined();
  });

  it('names the missing migrations and how to apply them', async () => {
    await expect(ensureMigrations(env.CHASKI_DB, 'missing_migrations')).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining(
        'missing migrations 0000_init.sql, 0001_delivery_latency.sql, 0002_channel_pauses.sql, ' +
          '0003_push_silent.sql, 0004_notification_data.sql. Apply them with `wrangler d1',
      ),
    });
  });

  it('answers the API with the config error before touching storage', async () => {
    const chaski = createChaski(() => ({
      ...fixtureConfig(env),
      migrationsTable: 'missing_migrations',
    }));
    const app = new Hono().route(
      '/chaski',
      chaski.routes({ dashboard: { authorize: () => ({ id: 'admin@host.test' }) } }),
    );

    const response = await app.request('/chaski/api/templates');

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'config',
      message: expect.stringContaining('missing migrations 0000_init.sql'),
    });
  });
});

// A host's health check asks Chaski whether it can run, without sending anything.
describe('chaski.ready()', () => {
  it('reports the channels and the environment, in process and over RPC', async () => {
    const chaski = useConfig();

    expect(await chaski.ready()).toEqual({
      channels: ['email', 'in_app'],
      paused: [],
      environment: null,
      templates: 0,
    });
    expect(await exports.ChaskiEntrypoint.ready()).toEqual({
      channels: ['email', 'in_app'],
      paused: [],
      environment: null,
      templates: 0,
    });
  });

  // With no template every send is refused, as on a fresh database or after a forgotten import.
  it('counts the templates a send can name, leaving out the deleted ones', async () => {
    const chaski = useConfig();
    await chaski.templates.import({
      format: 'chaski.templates',
      version: 1,
      templates: [{ type: 'welcome' }, { type: 'payment_received' }, { type: 'old' }],
    });
    await TemplateService.deleteTemplate((await TemplateService.getByType('old')).template.id);

    expect((await chaski.ready()).templates).toBe(2);
  });

  it('throws the config error a send would', async () => {
    await expect(
      useConfig({ migrationsTable: 'missing_migrations' }).ready(),
    ).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining('missing migrations 0000_init.sql'),
    });
    await expect(useConfig({ publicUrl: '/relative' }).ready()).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining('publicUrl must be the absolute http(s) URL'),
    });
  });

  // A database that doesn't answer is down, not missing migrations.
  it('passes on a database failure as it is', async () => {
    const broken = {
      prepare: () => ({
        all: async () => {
          throw new Error('D1_ERROR: Network connection lost.');
        },
      }),
    } as unknown as D1Database;
    const config = fixtureConfig(env);
    const chaski = useConfig({ bindings: { ...config.bindings, db: broken } });

    await expect(chaski.ready()).rejects.toThrowError('Network connection lost');
  });
});
