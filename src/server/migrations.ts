import { ChaskiError } from '../contract/errors';
import { baseConfig, type ResolvedConfig, resolveConfig, validateConfig } from './config';
import { SettingsService } from './services/settings.service';

// The files the package ships in migrations/; a test keeps this list in sync.
// They go in with `wrangler d1 migrations apply`, and Chaski refuses to run
// against a database that is missing any of them. The pre-release migrations
// were folded into 0000_init.sql, which keeps its name: a database that applied
// them has the same schema and still lists it.
export const MIGRATIONS: readonly string[] = ['0000_init.sql'];

// Wrangler's own table: Chaski's wrangler.jsonc leaves migrations_table unset.
const MIGRATIONS_TABLE = 'd1_migrations';

const verified = new WeakSet<D1Database>();

// `fresh` asks the database again, for a readiness check that must also see D1 answer.
export const ensureMigrations = async (db: D1Database, { fresh = false } = {}): Promise<void> => {
  if (!fresh && verified.has(db)) return;
  let applied = new Set<string>();
  try {
    const { results } = await db
      .prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)
      .all<{ name: string }>();
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
        '`wrangler d1 migrations apply CHASKI_DB --remote`, or `--local` under `wrangler dev`.',
    );
  }
  verified.add(db);
};

// Every entry point runs this before touching storage, so a misconfigured Worker
// fails on its first request with the reason instead of deep inside a service. It
// loads the channel settings too: the config reads them, and a change on the Channels
// page has to apply from the next request on, whichever isolate serves it.
export const ready = async (options: { fresh?: boolean } = {}): Promise<ResolvedConfig> => {
  const config = validateConfig(baseConfig());
  await ensureMigrations(config.bindings.db, options);
  await SettingsService.load();
  return resolveConfig();
};
