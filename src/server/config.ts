import { env } from 'cloudflare:workers';
import type { Channel } from '../contract/contract';
import { ChaskiError } from '../contract/errors';
import type { DeliveryMessage } from './types';

export type ChaskiBindings = {
  /** The D1 database chaski keeps its data in. */
  db: D1Database;
  /** The delivery queue; the host's consumer passes its batches to chaski.queue(). */
  queue: Queue<DeliveryMessage>;
};

export type ErrorSource = 'http' | 'queue';

export type ErrorContext = {
  source: ErrorSource;
  deliveryId?: string;
  notificationId?: string;
  channel?: string;
};

export type ChaskiConfig = {
  bindings: ChaskiBindings;
  /** Must match `max_retries` on the host's queue consumer; defaults to 5. */
  maxRetries?: number;
  /** Must match `migrations_table` on the host's D1 binding; defaults to `d1_migrations`. */
  migrationsTable?: string;
  /** Receives every unexpected error chaski handles on its own. */
  onError?: (error: unknown, context: ErrorContext) => void;
};

export type ResolvedConfig = {
  bindings: ChaskiBindings;
  enabledChannels: Channel[];
  maxRetries: number;
  migrationsTable: string;
  onError?: (error: unknown, context: ErrorContext) => void;
};

const fail = (message: string): never => {
  throw new ChaskiError('config', `chaski config: ${message}`);
};

export const validateConfig = (config: ChaskiConfig): ResolvedConfig => {
  const bindings = config.bindings ?? fail('bindings is required');
  for (const name of ['db', 'queue'] as const) {
    if (!bindings[name]) fail(`bindings.${name} is missing`);
  }

  const maxRetries = config.maxRetries ?? 5;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    fail('maxRetries must be a non-negative integer');
  }

  const migrationsTable = config.migrationsTable ?? 'd1_migrations';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(migrationsTable)) {
    fail('migrationsTable must be a plain table name');
  }

  return {
    bindings,
    enabledChannels: [],
    maxRetries,
    migrationsTable,
    onError: config.onError,
  };
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
