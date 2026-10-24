import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createChaski } from '../src';
import { ensureMigrations, MIGRATIONS } from '../src/server/migrations';

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
        'missing migrations 0000_init.sql. Apply them with `wrangler d1 migrations apply',
      ),
    });
  });

  it('answers the API with the config error before touching storage', async () => {
    const chaski = createChaski(() => ({
      bindings: { db: env.CHASKI_DB },
      migrationsTable: 'missing_migrations',
    }));
    const app = new Hono().route(
      '/chaski',
      chaski.routes({ dashboard: { authorize: () => true } }),
    );

    const response = await app.request('/chaski/api/templates');

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'config',
      message: expect.stringContaining('missing migrations 0000_init.sql'),
    });
  });
});
