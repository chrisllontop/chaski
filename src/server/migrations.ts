import { ChaskiError } from '../contract/errors';
import { type ResolvedConfig, resolveConfig } from './config';

// The files the package ships in migrations/; a test keeps this list in sync.
// The host applies them with `wrangler d1 migrations apply`, and Chaski refuses
// to run against a database that is missing any of them.
export const MIGRATIONS: readonly string[] = [
  '0000_init.sql',
  '0001_delivery_latency.sql',
  '0002_channel_pauses.sql',
  '0003_push_silent.sql',
  '0004_notification_data.sql',
];

const verified = new WeakMap<D1Database, string>();

// `fresh` asks the database again, for a readiness check that must also see D1 answer.
export const ensureMigrations = async (
  db: D1Database,
  table: string,
  { fresh = false } = {},
): Promise<void> => {
  if (!fresh && verified.get(db) === table) return;
  let applied = new Set<string>();
  try {
    const { results } = await db.prepare(`SELECT name FROM ${table}`).all<{ name: string }>();
    applied = new Set(results.map((row) => row.name));
  } catch (error) {
    // No migrations table yet means nothing was applied; any other failure is D1's, and must
    // not read as missing migrations.
    if (!(error instanceof Error && error.message.includes('no such table'))) throw error;
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
export const ready = async (options: { fresh?: boolean } = {}): Promise<ResolvedConfig> => {
  const config = resolveConfig();
  await ensureMigrations(config.bindings.db, config.migrationsTable, options);
  return config;
};
