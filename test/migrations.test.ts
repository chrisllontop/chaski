import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api as chaski } from '../src/server/api';
import { ensureMigrations, MIGRATIONS } from '../src/server/migrations';
import { TemplateService } from '../src/server/services/template.service';
import { fixtureConfig } from './fixture/worker';
import { api, useConfig } from './helpers';

// A database whose migrations table lists these names, as wrangler would have recorded them.
const appliedAs = (names: string[]) =>
  ({
    prepare: () => ({ all: async () => ({ results: names.map((name) => ({ name })) }) }),
  }) as unknown as D1Database;

// A database where wrangler applied nothing yet.
const fresh = appliedAs([]);

const useFreshDatabase = () => {
  const config = fixtureConfig(env);
  useConfig({ bindings: { ...config.bindings, db: fresh } });
};

describe('migrations', () => {
  it('lists every file the package ships in migrations/', () => {
    expect(MIGRATIONS).toEqual(env.TEST_MIGRATIONS.map((migration) => migration.name));
  });

  it('passes once every migration is applied', async () => {
    await expect(ensureMigrations(env.CHASKI_DB)).resolves.toBeUndefined();
  });

  it('names the missing migrations and how to apply them', async () => {
    await expect(ensureMigrations(fresh)).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining(
        'missing migrations 0000_init.sql, 0001_send_in_several_languages.sql. Apply them with ' +
          '`wrangler d1 migrations apply CHASKI_DB --remote`, or `--local` under `wrangler dev`.',
      ),
    });
  });

  // The pre-release migrations became 0000_init.sql under its old name, so a database that applied
  // them, and holds the same schema, keeps running without applying anything.
  it('passes a database that applied the pre-release migrations', async () => {
    const preRelease = appliedAs([
      '0000_init.sql',
      '0001_delivery_latency.sql',
      '0002_channel_pauses.sql',
      '0003_push_silent.sql',
      '0004_notification_data.sql',
      '0005_channel_settings.sql',
      '0001_send_in_several_languages.sql',
    ]);

    await expect(ensureMigrations(preRelease)).resolves.toBeUndefined();
  });

  it('answers the API with the config error before touching storage', async () => {
    useFreshDatabase();

    const response = await api('/templates');

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'config',
      message: expect.stringContaining('missing migrations 0000_init.sql'),
    });
  });
});

// An app's health check asks Chaski whether it can run, without sending anything.
describe('ready()', () => {
  it('reports the channels and the environment, in process and over RPC', async () => {
    expect(await chaski.ready()).toEqual({
      channels: ['email', 'in_app'],
      paused: [],
      problems: [],
      environment: null,
      templates: 0,
    });
    expect(await exports.ChaskiEntrypoint.ready()).toEqual({
      channels: ['email', 'in_app'],
      paused: [],
      problems: [],
      environment: null,
      templates: 0,
    });
  });

  // With no template every send is refused, as on a fresh database or after a forgotten import.
  it('counts the templates a send can name, leaving out the deleted ones', async () => {
    await chaski.templates.import({
      format: 'chaski.templates',
      version: 1,
      templates: [{ type: 'welcome' }, { type: 'payment_received' }, { type: 'old' }],
    });
    await TemplateService.deleteTemplate((await TemplateService.getByType('old')).template.id);

    expect((await chaski.ready()).templates).toBe(2);
  });

  it('throws the config error a send would', async () => {
    useFreshDatabase();
    await expect(chaski.ready()).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining('missing migrations 0000_init.sql'),
    });
    useConfig({ publicUrl: '/relative' });
    await expect(chaski.ready()).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining('CHASKI_PUBLIC_URL must be the absolute http(s) URL'),
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
    useConfig({ bindings: { ...config.bindings, db: broken } });

    await expect(chaski.ready()).rejects.toThrowError('Network connection lost');
  });
});
