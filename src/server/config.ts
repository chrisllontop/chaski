import { env } from 'cloudflare:workers';
import type { ChannelProblem } from '../contract/api';
import { CHANNELS, type Channel } from '../contract/contract';
import { ChaskiError, isChaskiError } from '../contract/errors';
import { canonicalLocale, type Locales } from '../contract/locales';
import type { SettingsSection } from './db/schema/channels';
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
  /** Seals the secrets saved on the Channels page; a Wrangler secret of 32 characters or more. */
  CHASKI_SECRET?: string;
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
  /** CHASKI_SECRET, which seals the secrets saved on the Channels page. */
  secret?: string;
  /**
   * Channels on from code, under the settings saved on the Channels page; only the test fixture
   * sets them. A channel is active when it has an entry.
   */
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
  /** The channels that are on: configured, or saved with settings that stopped validating. */
  enabledChannels: Channel[];
  defaultMutedTypes: string[];
  /** The languages saved on the Channels page; with none, every send renders its default content. */
  locales: Locales | null;
  environment: string | null;
  /**
   * Why each saved section that stopped validating can't be used, in validateConfig's words. Its
   * channel stays on, so its deliveries fail with this instead of skipping as unconfigured.
   */
  problems: Partial<Record<SettingsSection, string>>;
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

// The default is left out of `supported`, which lists the other languages a translation can be in.
const resolveLocales = (locales: Locales): Locales => {
  const defaultLocale = canonicalLocale(locales.default);
  if (!defaultLocale) fail('locales.default must be a BCP 47 language tag, such as en');
  if (!Array.isArray(locales.supported)) fail('locales.supported must be a list of language tags');
  const supported = locales.supported.map((tag) => {
    const locale = canonicalLocale(tag);
    if (!locale) fail(`locales.supported holds '${tag}', which is not a BCP 47 language tag`);
    return locale as string;
  });
  return {
    default: defaultLocale as string,
    supported: [...new Set(supported)].filter((locale) => locale !== defaultLocale),
  };
};

const resolveEmail = (email: EmailConfig): EmailConfig => {
  if (!email.from?.includes('@')) fail('channels.email.from must be an email address');
  return email;
};

/** The binding a channel's section can't work without, refused as validateConfig refuses it. */
export const requireBinding = (section: SettingsSection, bindings: ChaskiBindings): void => {
  if (section === 'email' && !bindings.email) {
    fail(`channels.email is configured but the ${bindingName('email')} binding is missing`);
  }
  if (section === 'in_app' && !bindings.feed) {
    fail(`channels.in_app is configured but the ${bindingName('feed')} binding is missing`);
  }
};

export type StoredSections = {
  email: EmailConfig;
  in_app: InAppConfig;
  vapid: VapidConfig;
  apns: ApnsConfig;
  fcm: FcmConfig;
  wns: WnsConfig;
  default_muted_types: string[];
  locales: Locales;
};

/** A saved section as loaded from the settings table: its fields, or why they can't be read. */
export type StoredSection<T> = { value: T } | { error: string };

export type StoredSettings = {
  [S in SettingsSection]?: StoredSection<StoredSections[S]>;
};

const RESOLVERS = {
  email: resolveEmail,
  in_app: (): InAppConfig => ({}),
  vapid: resolveVapid,
  apns: resolveApns,
  fcm: resolveFcm,
  wns: resolveWns,
  default_muted_types: (types: string[]) => types,
  locales: resolveLocales,
} satisfies { [S in SettingsSection]: (value: StoredSections[S]) => unknown };

type Resolved<S extends SettingsSection> = ReturnType<(typeof RESOLVERS)[S]>;

/** Checks a section as validateConfig does, its binding first, and throws its `config` error. */
export const resolveSection = <S extends SettingsSection>(
  section: S,
  value: StoredSections[S],
  bindings: ChaskiBindings,
): Resolved<S> => {
  requireBinding(section, bindings);
  const resolve = RESOLVERS[section] as unknown as (value: StoredSections[S]) => Resolved<S>;
  return resolve(value);
};

/** The channel a section turns on; default_muted_types and locales belong to none. */
export const SECTION_CHANNEL = {
  email: 'email',
  in_app: 'in_app',
  vapid: 'push',
  apns: 'push',
  fcm: 'push',
  wns: 'push',
  default_muted_types: null,
  locales: null,
} as const satisfies Record<SettingsSection, Channel | null>;

/** Each saved section that stopped validating, under the channel it fails. */
export const channelProblems = (config: ResolvedConfig): ChannelProblem[] =>
  Object.entries(config.problems).flatMap(([section, message]) => {
    const channel = SECTION_CHANNEL[section as SettingsSection];
    return channel && message ? [{ channel, message }] : [];
  });

const checkBindings = (bindings: ChaskiBindings): ChaskiBindings => {
  for (const name of ['db', 'queue'] as const) {
    if (!bindings[name]) fail(`the ${bindingName(name)} binding is missing`);
  }
  return bindings;
};

export const validateConfig = (
  config: ChaskiConfig,
  stored: StoredSettings = {},
): ResolvedConfig => {
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

  const bindings = checkBindings(config.bindings);

  const channels = config.channels ?? {};
  if (channels.push && !Object.values(channels.push).some(Boolean)) {
    fail(
      'channels.push needs vapid (web push), apns (iOS, macOS), fcm (Android), wns (Windows) ' +
        'or several of them',
    );
  }
  const fromCode: { [S in SettingsSection]: StoredSections[S] | undefined } = {
    email: channels.email,
    in_app: channels.in_app,
    vapid: channels.push?.vapid,
    apns: channels.push?.apns,
    fcm: channels.push?.fcm,
    wns: channels.push?.wns,
    default_muted_types: config.defaultMutedTypes,
    // The languages are saved on the Channels page only, where a change of default is checked.
    locales: undefined,
  };

  // A saved section replaces the code's. The code's throws, as a bad config always has; a saved one
  // that stops validating only stops its channel, so the dashboard stays up to fix it.
  const problems: ResolvedConfig['problems'] = {};
  const section = <S extends SettingsSection>(name: S): Resolved<S> | undefined => {
    const saved = stored[name] as StoredSection<StoredSections[S]> | undefined;
    if (!saved) {
      const value = fromCode[name];
      return value === undefined ? undefined : resolveSection(name, value, bindings);
    }
    if ('error' in saved) {
      problems[name] = saved.error;
      return undefined;
    }
    try {
      return resolveSection(name, saved.value, bindings);
    } catch (error) {
      if (!isChaskiError(error)) throw error;
      problems[name] = error.message;
      return undefined;
    }
  };

  const email = section('email');
  const inApp = section('in_app');
  const push = {
    vapid: section('vapid'),
    apns: section('apns'),
    fcm: section('fcm'),
    wns: section('wns'),
  };
  const defaultMutedTypes = section('default_muted_types') ?? [];
  const locales = section('locales') ?? null;
  const configured: Record<Channel, boolean> = {
    email: Boolean(email),
    in_app: Boolean(inApp),
    push: Object.values(push).some(Boolean),
  };
  const failing = (channel: Channel) =>
    Object.keys(problems).some((name) => SECTION_CHANNEL[name as SettingsSection] === channel);
  const enabledChannels = CHANNELS.filter((channel) => configured[channel] || failing(channel));

  const resolved: ResolvedConfig['channels'] = {};
  if (email) resolved.email = email;
  if (inApp) resolved.in_app = inApp;
  // On with any provider: a broken one fails its own platforms, and the others still send.
  if (enabledChannels.includes('push')) resolved.push = push;

  return {
    publicUrl: publicUrl ? publicUrl.href.replace(/\/+$/, '') : null,
    bindings,
    channels: resolved,
    enabledChannels,
    defaultMutedTypes,
    locales,
    environment: config.environment?.trim() || null,
    problems,
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
  secret: env.CHASKI_SECRET,
});

let configure: (env: ChaskiEnv) => ChaskiConfig = configFromEnv;

/** The test fixture turns channels on and swaps bindings through this. */
export const setConfigure = (fn: (env: ChaskiEnv) => ChaskiConfig): void => {
  configure = fn;
};

/** The config from the env alone, before the settings saved on the Channels page and unchecked. */
export const baseConfig = (): ChaskiConfig => configure(env as unknown as ChaskiEnv);

/** The bindings alone, which never wait on the settings: storage and the pixel need only these. */
export const resolveBindings = (): ChaskiBindings => checkBindings(baseConfig().bindings);

let stored: StoredSettings | undefined;

/** What the last load of the settings table found; ready() loads it on every request. */
export const setStoredSettings = (settings: StoredSettings | undefined): void => {
  stored = settings;
};

// Evaluated on every call, so nothing here outlives a vitest binding swap or a secret rotation. The
// settings come from the last load in this isolate: ready() loads them before anything reads the
// config, so a change on the Channels page applies from the next request on, in every isolate.
export const resolveConfig = (): ResolvedConfig => {
  if (!stored) {
    throw new ChaskiError(
      'internal',
      'Chaski read its config before loading the channel settings: await ready() first',
    );
  }
  return validateConfig(baseConfig(), stored);
};
