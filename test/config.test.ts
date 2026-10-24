import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/server/config';
import { fixtureConfig } from './fixture/worker';

describe('config', () => {
  it.each(['db', 'queue'] as const)('names a missing %s binding', (name) => {
    const config = fixtureConfig(env);
    expect(() =>
      validateConfig({ ...config, bindings: { ...config.bindings, [name]: undefined } }),
    ).toThrowError(
      expect.objectContaining({
        code: 'config',
        message: `chaski config: bindings.${name} is missing`,
      }),
    );
  });

  it('rejects a migrations table that is not a plain name', () => {
    expect(() =>
      validateConfig({ ...fixtureConfig(env), migrationsTable: 'd1; DROP TABLE x' }),
    ).toThrowError(expect.objectContaining({ code: 'config' }));
  });

  it('defaults the migrations table and retries to what Wrangler uses', () => {
    expect(validateConfig(fixtureConfig(env))).toMatchObject({
      migrationsTable: 'd1_migrations',
      maxRetries: 5,
    });
  });
});
