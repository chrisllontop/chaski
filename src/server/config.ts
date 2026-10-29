import { env } from 'cloudflare:workers';
import { CHANNELS, type Channel } from '../contract/contract';
import { ChaskiError } from '../contract/errors';
import type { ChaskiEvents } from './durable/events';
import type { ChaskiFeed } from './durable/feed';
import type { ApnsCredentials } from './lib/apns';
import { decodeBase64Url, encodeBase64Url } from './lib/base64';
import type { FcmCredentials } from './lib/fcm';
import type { DeliveryMessage, ScheduleParams, SendEmailBinding } from './types';

export type ChaskiBindings = {
  /** The D1 database Chaski keeps its data in. */
  db: D1Database;
  /** The delivery queue; the host's consumer passes its batches to chaski.queue(). */
  queue: Queue<DeliveryMessage>;
  /** The host's `send_email` binding; required when the email channel is configured. */
  email?: SendEmailBinding;
  /** The ChaskiEvents Durable Object namespace; without it the dashboard gets no realtime updates. */
  events?: DurableObjectNamespace<ChaskiEvents>;
  /** The ChaskiScheduler Workflow; required by chaski.schedule(). */
  scheduler?: Workflow<ScheduleParams>;
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

export type FcmConfig = {
  /** The contents of the service account's JSON key file, from the Firebase console. */
  serviceAccount: string;
};

/** Web push needs `vapid`, iOS needs `apns`, Android needs `fcm`; configure any of them. */
export type PushConfig = {
  vapid?: VapidConfig;
  apns?: ApnsConfig;
  fcm?: FcmConfig;
};

export type ResolvedPush = {
  vapid?: { subject: string; publicKey: string; privateJwk: string };
  apns?: ApnsCredentials;
  fcm?: FcmCredentials;
};

export type ErrorSource =
  | 'http'
  | 'queue'
  | 'workflow'
  | 'tracking'
  | 'feed'
  | 'events'
  | 'attachments';

export type ErrorContext = {
  source: ErrorSource;
  deliveryId?: string;
  notificationId?: string;
  scheduledId?: string;
  channel?: string;
};

export type ChaskiConfig = {
  /** Absolute URL where the host mounts Chaski, e.g. `https://app.example.com/chaski`. */
  publicUrl: string;
  bindings: ChaskiBindings;
  /** A channel is active when it has a config entry. */
  channels?: {
    email?: EmailConfig;
    in_app?: InAppConfig;
    push?: PushConfig;
  };
  /** Type mutes every recipient has until they save preferences of their own. */
  defaultMutedTypes?: string[];
  /**
   * Where this Worker runs, as the dashboard shows it, such as `production` or `staging`. `local`
   * is for `wrangler dev`: it opens the dashboard without `authorize` and needs a `publicUrl` on
   * localhost. Any other value, or none, is a deployed environment.
   */
  environment?: string;
  /** Must match `max_retries` on the host's queue consumer; defaults to 5. */
  maxRetries?: number;
  /** Must match `migrations_table` on the host's D1 binding; defaults to `d1_migrations`. */
  migrationsTable?: string;
  /** Receives every unexpected error Chaski handles on its own. */
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
  defaultMutedTypes: string[];
  environment: string | null;
  maxRetries: number;
  migrationsTable: string;
  onError?: (error: unknown, context: ErrorContext) => void;
};

/** The one environment that changes what Chaski does: see `ChaskiConfig.environment`. */
export const LOCAL_ENVIRONMENT = 'local';

const isLoopback = ({ hostname }: URL): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  /^127(\.\d{1,3}){3}$/.test(hostname);

const fail = (message: string): never => {
  throw new ChaskiError('config', `Chaski config: ${message}`);
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

const SERVICE_ACCOUNT_FIELDS = ['project_id', 'client_email', 'private_key_id', 'private_key'];

const resolveFcm = (fcm: FcmConfig): FcmCredentials => {
  let account: unknown = null;
  try {
    account = JSON.parse(fcm.serviceAccount ?? '');
  } catch {
    // Reported below, with the same message as JSON that isn't an object.
  }
  if (!account || typeof account !== 'object') {
    fail('channels.push.fcm.serviceAccount must be the contents of the service account JSON file');
  }
  const fields = account as Record<string, unknown>;
  for (const field of SERVICE_ACCOUNT_FIELDS) {
    if (typeof fields[field] !== 'string' || !fields[field]) {
      fail(`channels.push.fcm.serviceAccount has no ${field}: use the JSON key file as downloaded`);
    }
  }
  if (!String(fields.private_key).includes('PRIVATE KEY')) {
    fail('channels.push.fcm.serviceAccount has a private_key that is not a PEM key');
  }
  return {
    projectId: String(fields.project_id),
    clientEmail: String(fields.client_email),
    privateKeyId: String(fields.private_key_id),
    privateKeyPem: String(fields.private_key),
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
    fail('publicUrl must be the absolute http(s) URL where Chaski is mounted');
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
    if (!channels.push.vapid && !channels.push.apns && !channels.push.fcm) {
      fail('channels.push needs vapid (web push), apns (iOS), fcm (Android) or several of them');
    }
    resolved.push = {
      vapid: channels.push.vapid ? resolveVapid(channels.push.vapid) : undefined,
      apns: channels.push.apns ? resolveApns(channels.push.apns) : undefined,
      fcm: channels.push.fcm ? resolveFcm(channels.push.fcm) : undefined,
    };
  }

  const maxRetries = config.maxRetries ?? 5;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    fail('maxRetries must be a non-negative integer');
  }

  if (config.environment !== undefined && typeof config.environment !== 'string') {
    fail('environment must be a string');
  }
  const environment = config.environment?.trim() || null;
  // A deploy that picks up 'local' by mistake would open its dashboard to anyone who finds it. Its
  // publicUrl still names the real host, so the two together are refused instead.
  if (environment === LOCAL_ENVIRONMENT && !isLoopback(publicUrl as URL)) {
    fail(
      `environment '${LOCAL_ENVIRONMENT}' opens the dashboard without authorize, so publicUrl ` +
        `must point at localhost, not ${(publicUrl as URL).host}`,
    );
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
    defaultMutedTypes: config.defaultMutedTypes ?? [],
    environment,
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
      "Chaski is not configured: call createChaski() in your Worker's main module",
    );
  }
  return validateConfig(configure(env as never));
};
