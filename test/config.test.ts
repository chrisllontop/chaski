import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/server/config';

describe('config', () => {
  it('names a missing binding', () => {
    expect(() => validateConfig({ bindings: {} as never })).toThrowError(
      expect.objectContaining({ code: 'config', message: 'chaski config: bindings.db is missing' }),
    );
  });

  it('rejects a migrations table that is not a plain name', () => {
    expect(() =>
      validateConfig({ bindings: { db: env.CHASKI_DB }, migrationsTable: 'd1; DROP TABLE x' }),
    ).toThrowError(expect.objectContaining({ code: 'config' }));
  });

  it('defaults the migrations table to the one Wrangler uses', () => {
    expect(validateConfig({ bindings: { db: env.CHASKI_DB } }).migrationsTable).toBe(
      'd1_migrations',
    );
  });
});
