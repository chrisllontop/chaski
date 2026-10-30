import { env } from 'cloudflare:workers';
import { CHANNELS, type Channel } from '../contract/contract';
import { ChaskiError } from '../contract/errors';
import type { ChaskiEvents } from './durable/events';
import type { ChaskiFeed } from './durable/feed';
import { APNS_PLATFORMS, type ApnsApp, type ApnsCredentials, type ApnsPlatform } from './lib/apns';
import { decodeBase64Url, encodeBase64Url } from './lib/base64';
import type { FcmCredentials } from './lib/fcm';
import type { WnsCredentials } from './lib/wns';
import type { DeliveryMessage, ScheduleParams, SendEmailBinding } from './types';

/** The Chaski Worker's bindings and vars, under the names its wrangler.jsonc declares. */
export type ChaskiEnv = {
  CHASKI_DB: D1Database;
  CHASKI_QUEUE: Queue<DeliveryMessage>;
  CHASKI_FEED?: DurableObjectNamespace<ChaskiFeed>;
  CHASKI_EVENTS?: DurableObjectNamespace<ChaskiEvents>;
  CHASKI_SCHEDULER?: Workflow<ScheduleParams>;
  CHASKI_EMAIL?: SendEmailBinding;
  CHASKI_ATTACHMENTS?: R2Bucket;
  /** Where this Worker runs, as the dashboard shows it, such as `production` or `staging`. */
  CHASKI_ENVIRONMENT?: string;
  /** Where the app mounts userRoutes(); emails track opens through it, and without it they don't. */
  CHASKI_PUBLIC_URL?: string;
};

export type ChaskiBindings = {
  db: D1Database;
  queue: Queue<DeliveryMessage>;
  /** Required when the email channel is configured. */
  email?: SendEmailBinding;
  /** Without it the dashboard gets no realtime updates. */
  events?: DurableObjectNamespace<ChaskiEvents>;
  /** Required by schedule(). */
  scheduler?: Workflow<ScheduleParams>;
  /** Required when the in_app channel is configured. */
  feed?: DurableObjectNamespace<ChaskiFeed>;
  /** Required by sends that carry email attachments. */
  attachments?: R2Bucket;
};

const BINDING_NAMES = {
  db: 'CHASKI_DB',
  queue: 'CHASKI_QUEUE',
  email: 'CHASKI_EMAIL',
  events: 'CHASKI_EVENTS',
  scheduler: 'CHASKI_SCHEDULER',
  feed: 'CHASKI_FEED',
  attachments: 'CHASKI_ATTACHMENTS',
} as const satisfies Record<keyof ChaskiBindings, keyof ChaskiEnv>;

/** How a missing binding is named in an error: the name it has in wrangler.jsonc. */
export const bindingName = (key: keyof ChaskiBindings): string => BINDING_NAMES[key];

export type EmailConfig = {
  /** The sender address; it must be allowed by the CHASKI_EMAIL send_email binding. */
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

export type ApnsAppConfig = {
  /** The app's bundle id, which APNs takes as the topic. */
  bundleId: string;
  /** The APNs environment of the app's tokens; a device may name its own when it registers. */
  environment: 'sandbox' | 'production';
};

/** One key sends to every app of the team: configure `ios`, `macos` or both. */
export type ApnsConfig = {
  teamId: string;
  keyId: string;
  /** The contents of the .p8 file (PKCS#8 PEM). */
  privateKey: string;
  ios?: ApnsAppConfig;
  macos?: ApnsAppConfig;
};

export type FcmConfig = {
  /** The contents of the service account's JSON key file, from the Firebase console. */
  serviceAccount: string;
};

/** The Microsoft Entra app a Windows App SDK app creates its push channel with. */
export type WnsConfig = {
  /** The directory (tenant) id of the app registration. */
  tenantId: string;
  /** The application (client) id of the app registration. */
  clientId: string;
  /** A client secret of the app registration. */
  clientSecret: string;
};

/**
 * Web push needs `vapid`, iOS and macOS need `apns`, Android needs `fcm`, Windows needs `wns`;
 * configure any of them.
 */
export type PushConfig = {
  vapid?: VapidConfig;
  apns?: ApnsConfig;
  fcm?: FcmConfig;
  wns?: WnsConfig;
};

export type ResolvedPush = {
  vapid?: { subject: string; publicKey: string; privateJwk: string };
  apns?: ApnsCredentials;
  fcm?: FcmCredentials;
  wns?: WnsCredentials;
};

export type ChaskiConfig = {
  /** Absolute URL where the app mounts userRoutes(), e.g. `https://app.example.com/notifications`. */
  publicUrl?: string;
  bindings: ChaskiBindings;
  /** A channel is active when it has a config entry. */
  channels?: {
    email?: EmailConfig;
    in_app?: InAppConfig;
    push?: PushConfig;
  };
  /** Type mutes every recipient has until they save preferences of their own. */
  defaultMutedTypes?: string[];
  /** Where this Worker runs, as the dashboard shows it, such as `production` or `staging`. */
  environment?: string;
};

export type ResolvedConfig = {
  publicUrl: string | null;
  bindings: ChaskiBindings;
  channels: {
    email?: EmailConfig;
    in_app?: InAppConfig;
    push?: ResolvedPush;
  };
  enabledChannels: Channel[];
  defaultMutedTypes: string[];
  environment: string | null;
};

const fail = (message: string): never => {
  throw new ChaskiError('config', `Chaski config: ${message}`);
};

// Subscriptions are bound to the public key they were made with, so each Chaski brings
// its own pair, in the raw base64url form web-push tools print.
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

const resolveApnsApp = (platform: ApnsPlatform, app: ApnsAppConfig): ApnsApp => {
  if (!app.bundleId) fail(`channels.push.apns.${platform}.bundleId is required`);
  if (app.environment !== 'sandbox' && app.environment !== 'production') {
    fail(`channels.push.apns.${platform}.environment must be 'sandbox' or 'production'`);
  }
  return { bundleId: app.bundleId, environment: app.environment };
};

const resolveApns = (apns: ApnsConfig): ApnsCredentials => {
  for (const field of ['teamId', 'keyId'] as const) {
    if (!apns[field]) fail(`channels.push.apns.${field} is required`);
  }
  if (!apns.privateKey?.includes('PRIVATE KEY')) {
    fail('channels.push.apns.privateKey must be the contents of the .p8 file');
  }
  if (!APNS_PLATFORMS.some((platform) => apns[platform])) {
    fail('channels.push.apns needs ios, macos or both: the bundle id and environment of each app');
  }
  const credentials: ApnsCredentials = {
    teamId: apns.teamId,
    keyId: apns.keyId,
    privateKeyPem: apns.privateKey,
  };
  for (const platform of APNS_PLATFORMS) {
    const app = apns[platform];
    if (app) credentials[platform] = resolveApnsApp(platform, app);
  }
  return credentials;
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

const resolveWns = (wns: WnsConfig): WnsCredentials => {
  for (const field of ['tenantId', 'clientId', 'clientSecret'] as const) {
    if (typeof wns[field] !== 'string' || !wns[field]) {
      fail(`channels.push.wns.${field} is required`);
    }
  }
  return { tenantId: wns.tenantId, clientId: wns.clientId, clientSecret: wns.clientSecret };
};

export const validateConfig = (config: ChaskiConfig): ResolvedConfig => {
  let publicUrl: URL | null = null;
  if (config.publicUrl) {
    try {
      publicUrl = new URL(config.publicUrl);
    } catch {
      // Reported below with the rest of the publicUrl rule.
    }
    if (!publicUrl || !/^https?:$/.test(publicUrl.protocol)) {
      fail('CHASKI_PUBLIC_URL must be the absolute http(s) URL where the app mounts userRoutes()');
    }
  }

  const bindings = config.bindings;
  for (const name of ['db', 'queue'] as const) {
    if (!bindings[name]) fail(`the ${bindingName(name)} binding is missing`);
  }

  const channels = config.channels ?? {};
  const resolved: ResolvedConfig['channels'] = {};
  if (channels.email) {
    if (!bindings.email) {
      fail(`channels.email is configured but the ${bindingName('email')} binding is missing`);
    }
    if (!channels.email.from?.includes('@')) fail('channels.email.from must be an email address');
    resolved.email = channels.email;
  }
  if (channels.in_app) {
    if (!bindings.feed) {
      fail(`channels.in_app is configured but the ${bindingName('feed')} binding is missing`);
    }
    resolved.in_app = {};
  }
  if (channels.push) {
    const { vapid, apns, fcm, wns } = channels.push;
    if (!vapid && !apns && !fcm && !wns) {
      fail(
        'channels.push needs vapid (web push), apns (iOS, macOS), fcm (Android), wns (Windows) ' +
          'or several of them',
      );
    }
    resolved.push = {
      vapid: vapid ? resolveVapid(vapid) : undefined,
      apns: apns ? resolveApns(apns) : undefined,
      fcm: fcm ? resolveFcm(fcm) : undefined,
      wns: wns ? resolveWns(wns) : undefined,
    };
  }

  return {
    publicUrl: publicUrl ? publicUrl.href.replace(/\/+$/, '') : null,
    bindings,
    channels: resolved,
    enabledChannels: CHANNELS.filter((channel) => resolved[channel]),
    defaultMutedTypes: config.defaultMutedTypes ?? [],
    environment: config.environment?.trim() || null,
  };
};

export const configFromEnv = (env: ChaskiEnv): ChaskiConfig => ({
  publicUrl: env.CHASKI_PUBLIC_URL,
  environment: env.CHASKI_ENVIRONMENT,
  bindings: {
    db: env.CHASKI_DB,
    queue: env.CHASKI_QUEUE,
    email: env.CHASKI_EMAIL,
    events: env.CHASKI_EVENTS,
    scheduler: env.CHASKI_SCHEDULER,
    feed: env.CHASKI_FEED,
    attachments: env.CHASKI_ATTACHMENTS,
  },
});

let configure: (env: ChaskiEnv) => ChaskiConfig = configFromEnv;

/** The test fixture turns channels on and swaps bindings through this. */
export const setConfigure = (fn: (env: ChaskiEnv) => ChaskiConfig): void => {
  configure = fn;
};

// Evaluated on every call, so nothing here outlives a vitest binding swap or a secret rotation.
export const resolveConfig = (): ResolvedConfig =>
  validateConfig(configure(env as unknown as ChaskiEnv));
