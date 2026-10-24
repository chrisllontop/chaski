import { env } from 'cloudflare:workers';
import { CHANNELS, type Channel } from '../contract/contract';
import { ChaskiError } from '../contract/errors';
import type { ChaskiFeed } from './durable/feed';
import type { ApnsCredentials } from './lib/apns';
import { decodeBase64Url, encodeBase64Url } from './lib/base64';
import type { DeliveryMessage, SendEmailBinding } from './types';

export type ChaskiBindings = {
  /** The D1 database chaski keeps its data in. */
  db: D1Database;
  /** The delivery queue; the host's consumer passes its batches to chaski.queue(). */
  queue: Queue<DeliveryMessage>;
  /** The host's `send_email` binding; required when the email channel is configured. */
  email?: SendEmailBinding;
  /** The ChaskiFeed Durable Object namespace; required when the in_app channel is configured. */
  feed?: DurableObjectNamespace<ChaskiFeed>;
  /** An R2 bucket; required by sends that carry email attachments. */
  attachments?: R2Bucket;
};

export type EmailConfig = {
  /** The sender address; it must be allowed by the host's send_email binding. */
  from: string;
  fromName?: string;
  replyTo?: string;
};

/** The in_app channel has no options yet; `{}` turns it on. */
export type InAppConfig = Record<string, never>;

export type VapidConfig = {
  /** A `mailto:` or `https:` contact the push services can reach you at. */
  subject: string;
  /** The base64url uncompressed P-256 public key (65 bytes), as web-push tools print it. */
  publicKey: string;
  /** The base64url P-256 private key (32 bytes), or the whole private JWK as JSON. */
  privateKey: string;
};

export type ApnsConfig = {
  teamId: string;
  keyId: string;
  bundleId: string;
  environment: 'sandbox' | 'production';
  /** The contents of the .p8 file (PKCS#8 PEM). */
  privateKey: string;
};

/** Web push needs `vapid`, iOS needs `apns`; configure either or both. */
export type PushConfig = {
  vapid?: VapidConfig;
  apns?: ApnsConfig;
};

export type ResolvedPush = {
  vapid?: { subject: string; publicKey: string; privateJwk: string };
  apns?: ApnsCredentials;
};

export type ErrorSource = 'http' | 'queue' | 'tracking' | 'feed';

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
    in_app?: InAppConfig;
    push?: PushConfig;
  };
  /** Render and record email and push deliveries without calling the providers. */
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
    in_app?: InAppConfig;
    push?: ResolvedPush;
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

// Subscriptions are bound to the public key they were made with, so hosts bring
// their own pair, in the raw base64url form web-push tools print.
const resolveVapid = (vapid: VapidConfig): NonNullable<ResolvedPush['vapid']> => {
  if (!/^(mailto:|https:)/.test(vapid.subject ?? '')) {
    fail('channels.push.vapid.subject must be a mailto: or https: URL');
  }
  const point = decodeBase64Url(vapid.publicKey ?? '');
  if (point?.length !== 65 || point[0] !== 4) {
    fail('channels.push.vapid.publicKey must be a base64url uncompressed P-256 key (65 bytes)');
  }
  const privateKey = (vapid.privateKey ?? '').trim();
  if (privateKey.startsWith('{')) {
    return { subject: vapid.subject, publicKey: vapid.publicKey, privateJwk: privateKey };
  }
  if (decodeBase64Url(privateKey)?.length !== 32) {
    fail('channels.push.vapid.privateKey must be a base64url P-256 private key (32 bytes)');
  }
  const xy = point as Uint8Array;
  const privateJwk = JSON.stringify({
    kty: 'EC',
    crv: 'P-256',
    x: encodeBase64Url(xy.slice(1, 33)),
    y: encodeBase64Url(xy.slice(33, 65)),
    d: privateKey,
  });
  return { subject: vapid.subject, publicKey: vapid.publicKey, privateJwk };
};

const resolveApns = (apns: ApnsConfig): ApnsCredentials => {
  for (const field of ['teamId', 'keyId', 'bundleId'] as const) {
    if (!apns[field]) fail(`channels.push.apns.${field} is required`);
  }
  if (apns.environment !== 'sandbox' && apns.environment !== 'production') {
    fail("channels.push.apns.environment must be 'sandbox' or 'production'");
  }
  if (!apns.privateKey?.includes('PRIVATE KEY')) {
    fail('channels.push.apns.privateKey must be the contents of the .p8 file');
  }
  return {
    teamId: apns.teamId,
    keyId: apns.keyId,
    bundleId: apns.bundleId,
    environment: apns.environment,
    privateKeyPem: apns.privateKey,
  };
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
  if (channels.in_app) {
    if (!bindings.feed) fail('channels.in_app is configured but bindings.feed is missing');
    resolved.in_app = {};
  }
  if (channels.push) {
    if (!channels.push.vapid && !channels.push.apns) {
      fail('channels.push needs vapid (web push), apns (iOS) or both');
    }
    resolved.push = {
      vapid: channels.push.vapid ? resolveVapid(channels.push.vapid) : undefined,
      apns: channels.push.apns ? resolveApns(channels.push.apns) : undefined,
    };
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
    enabledChannels: CHANNELS.filter((channel) => resolved[channel]),
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
