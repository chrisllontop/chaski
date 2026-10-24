import { env } from 'cloudflare:workers';
import { CHANNELS, type Channel } from '../contract/contract';
import { ChaskiError } from '../contract/errors';
import type { DeliveryMessage, SendEmailBinding } from './types';

export type ChaskiBindings = {
  /** The D1 database chaski keeps its data in. */
  db: D1Database;
  /** The delivery queue; the host's consumer passes its batches to chaski.queue(). */
  queue: Queue<DeliveryMessage>;
  /** The host's `send_email` binding; required when the email channel is configured. */
  email?: SendEmailBinding;
  /** An R2 bucket; required by sends that carry email attachments. */
  attachments?: R2Bucket;
};

export type EmailConfig = {
  /** The sender address; it must be allowed by the host's send_email binding. */
  from: string;
  fromName?: string;
  replyTo?: string;
};

export type ErrorSource = 'http' | 'queue' | 'tracking';

export type ErrorContext = {
  source: ErrorSource;
  deliveryId?: string;
  notificationId?: string;
  channel?: string;
};

export type ChaskiConfig = {
  /** Absolute URL where the host mounts chaski, e.g. `https://app.example.com/chaski`. */
  publicUrl: string;
  bindings: ChaskiBindings;
  /** A channel is active when it has a config entry. */
  channels?: {
    email?: EmailConfig;
  };
  /** Render and record email deliveries without calling the provider. */
  dryRun?: boolean;
  /** Must match `max_retries` on the host's queue consumer; defaults to 5. */
  maxRetries?: number;
  /** Must match `migrations_table` on the host's D1 binding; defaults to `d1_migrations`. */
  migrationsTable?: string;
  /** Receives every unexpected error chaski handles on its own. */
  onError?: (error: unknown, context: ErrorContext) => void;
};

export type ResolvedConfig = {
  publicUrl: string;
  bindings: ChaskiBindings;
  channels: {
    email?: EmailConfig;
  };
  enabledChannels: Channel[];
  dryRun: boolean;
  maxRetries: number;
  migrationsTable: string;
  onError?: (error: unknown, context: ErrorContext) => void;
};

const fail = (message: string): never => {
  throw new ChaskiError('config', `chaski config: ${message}`);
};

export const validateConfig = (config: ChaskiConfig): ResolvedConfig => {
  let publicUrl: URL | null = null;
  try {
    publicUrl = new URL(config.publicUrl);
  } catch {
    // Reported below with the rest of the publicUrl rule.
  }
  if (!publicUrl || !/^https?:$/.test(publicUrl.protocol)) {
    fail('publicUrl must be the absolute http(s) URL where chaski is mounted');
  }

  const bindings = config.bindings ?? fail('bindings is required');
  for (const name of ['db', 'queue'] as const) {
    if (!bindings[name]) fail(`bindings.${name} is missing`);
  }

  const channels = config.channels ?? {};
  const resolved: ResolvedConfig['channels'] = {};
  if (channels.email) {
    if (!bindings.email) fail('channels.email is configured but bindings.email is missing');
    if (!channels.email.from?.includes('@')) fail('channels.email.from must be an email address');
    resolved.email = channels.email;
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
    publicUrl: (publicUrl as URL).href.replace(/\/+$/, ''),
    bindings,
    channels: resolved,
    enabledChannels: CHANNELS.filter((channel) => resolved[channel as keyof typeof resolved]),
    dryRun: config.dryRun ?? false,
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
