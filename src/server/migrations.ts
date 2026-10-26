import { ChaskiError } from '../contract/errors';
import { type ResolvedConfig, resolveConfig } from './config';

// The files the package ships in migrations/; a test keeps this list in sync.
// The host applies them with `wrangler d1 migrations apply`, and Chaski refuses
// to run against a database that is missing any of them.
export const MIGRATIONS: readonly string[] = ['0000_init.sql', '0001_delivery_latency.sql'];

const verified = new WeakMap<D1Database, string>();

export const ensureMigrations = async (db: D1Database, table: string): Promise<void> => {
  if (verified.get(db) === table) return;
  let applied = new Set<string>();
  try {
    const { results } = await db.prepare(`SELECT name FROM ${table}`).all<{ name: string }>();
    applied = new Set(results.map((row) => row.name));
  } catch {
    // No migrations table yet: nothing was applied.
  }
  const missing = MIGRATIONS.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new ChaskiError(
      'config',
      `Chaski: the database is missing migrations ${missing.join(', ')}. Apply them with ` +
        '`wrangler d1 migrations apply <database>`, with migrations_dir set to ' +
        'node_modules/chaskijs/migrations.',
    );
  }
  verified.set(db, table);
};

// Every entry point runs this before touching storage, so a misconfigured host
// fails on its first request with the reason instead of deep inside a service.
export const ready = async (): Promise<ResolvedConfig> => {
  const config = resolveConfig();
  await ensureMigrations(config.bindings.db, config.migrationsTable);
  return config;
};
