import { env } from 'cloudflare:workers';
import { ChaskiError } from '../contract/errors';

export type ChaskiBindings = {
  /** The D1 database chaski keeps its data in. */
  db: D1Database;
};

export type ErrorSource = 'http';

export type ErrorContext = {
  source: ErrorSource;
};

export type ChaskiConfig = {
  bindings: ChaskiBindings;
  /** Must match `migrations_table` on the host's D1 binding; defaults to `d1_migrations`. */
  migrationsTable?: string;
  /** Receives every unexpected error chaski handles on its own. */
  onError?: (error: unknown, context: ErrorContext) => void;
};

export type ResolvedConfig = {
  bindings: ChaskiBindings;
  migrationsTable: string;
  onError?: (error: unknown, context: ErrorContext) => void;
};

const fail = (message: string): never => {
  throw new ChaskiError('config', `chaski config: ${message}`);
};

export const validateConfig = (config: ChaskiConfig): ResolvedConfig => {
  const bindings = config.bindings ?? fail('bindings is required');
  if (!bindings.db) fail('bindings.db is missing');

  const migrationsTable = config.migrationsTable ?? 'd1_migrations';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(migrationsTable)) {
    fail('migrationsTable must be a plain table name');
  }

  return { bindings, migrationsTable, onError: config.onError };
};

let configure: ((env: never) => ChaskiConfig) | undefined;

export const setConfigure = <E>(fn: (env: E) => ChaskiConfig): void => {
  configure = fn as (env: never) => ChaskiConfig;
};

// Evaluated on every call: the host owns the config and its env, and nothing
// here may outlive a vitest binding swap or a secret rotation.
export const resolveConfig = (): ResolvedConfig => {
  if (!configure) {
    throw new ChaskiError(
      'config',
      "chaski is not configured: call createChaski() in your Worker's main module",
    );
  }
  return validateConfig(configure(env as never));
};
