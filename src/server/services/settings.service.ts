import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ChaskiError, isChaskiError } from '../../contract/errors';
import { canonicalLocale, type Locales } from '../../contract/locales';
import type { Actor } from '../auth';
import {
  type ApnsAppConfig,
  baseConfig,
  type ResolvedPush,
  requireBinding,
  resolveSection,
  type StoredSection,
  type StoredSections,
  type StoredSettings,
  setStoredSettings,
} from '../config';
import { type SettingsSection, settings } from '../db/schema';
import { publishAdminEvents } from '../lib/admin-events';
import { decodeBase64Url, encodeBase64Url } from '../lib/base64';
import { parseJson } from '../lib/json';
import { seal, secretStatus, unseal } from '../lib/sealed';
import { BaseService } from './base.service';

type SettingsRow = typeof settings.$inferSelect;

/** Where each section sits in validateConfig's messages, so a saved one reads the same. */
export const SECTION_PATH: Record<SettingsSection, string> = {
  email: 'channels.email',
  in_app: 'channels.in_app',
  vapid: 'channels.push.vapid',
  apns: 'channels.push.apns',
  fcm: 'channels.push.fcm',
  wns: 'channels.push.wns',
  default_muted_types: 'defaultMutedTypes',
  locales: 'locales',
};

// Each section has at most one secret, sealed in the row's `secret` column instead of its value.
const SECRET_FIELD: Partial<Record<SettingsSection, string>> = {
  vapid: 'privateKey',
  apns: 'privateKey',
  fcm: 'serviceAccount',
  wns: 'clientSecret',
};

export const mutedTypesSchema = z.array(z.string().trim().min(1).max(128)).max(200);

const SECRET_FIX =
  'run `wrangler secret put CHASKI_SECRET` with a value from `openssl rand -base64 32`';

const secretField = (section: SettingsSection) =>
  `${SECTION_PATH[section]}.${SECRET_FIELD[section]}`;

/** CHASKI_SECRET must be able to seal before anything with a secret is saved. */
const requireSecret = (section: SettingsSection): string => {
  const { secret } = baseConfig();
  const status = secretStatus(secret);
  if (status === 'missing') {
    throw new ChaskiError(
      'config',
      `Chaski config: CHASKI_SECRET is missing, and ${secretField(section)} is stored encrypted ` +
        `with it: ${SECRET_FIX}`,
    );
  }
  if (status === 'too_short') {
    throw new ChaskiError(
      'config',
      `Chaski config: CHASKI_SECRET must be at least 32 characters: ${SECRET_FIX}`,
    );
  }
  return secret ?? '';
};

const undecryptable = (section: SettingsSection) =>
  `Chaski config: ${secretField(section)} doesn't decrypt with this CHASKI_SECRET: set the ` +
  `CHASKI_SECRET it was saved with, or save ${SECTION_PATH[section]} again`;

const readSection = async (
  row: SettingsRow,
  secret: string | undefined,
): Promise<StoredSection<unknown>> => {
  const { section } = row;
  const value = parseJson<Record<string, unknown> | null>(row.value, null);
  if (!value || typeof value !== 'object') {
    return {
      error: `Chaski config: the saved ${SECTION_PATH[section]} can't be read: save it again`,
    };
  }
  if (section === 'default_muted_types') {
    const types = mutedTypesSchema.safeParse(value.mutedTypes);
    return types.success
      ? { value: types.data }
      : { error: "Chaski config: the saved defaultMutedTypes can't be read: save them again" };
  }
  const field = SECRET_FIELD[section];
  if (!field || !row.secret) return { value };
  if (secretStatus(secret) === 'missing') {
    return {
      error:
        `Chaski config: ${secretField(section)} is stored encrypted, but CHASKI_SECRET is ` +
        'missing: set the CHASKI_SECRET it was saved with (`wrangler secret put CHASKI_SECRET`)',
    };
  }
  const plaintext = await unseal(secret ?? '', section, row.secret);
  return plaintext === null
    ? { error: undecryptable(section) }
    : { value: { ...value, [field]: plaintext } };
};

// Applies an update the way a PATCH does: an absent key keeps the stored value, null clears it.
const merge = (current: Record<string, unknown>, update: Record<string, unknown>) => {
  const next = { ...current };
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next;
};

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

// resolveVapid builds the private JWK from the public key's point and the private scalar, so a
// pair that doesn't belong together only shows when a signature fails to verify.
const assertKeyPair = async (vapid: NonNullable<ResolvedPush['vapid']>): Promise<void> => {
  const probe = new TextEncoder().encode('chaski');
  try {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(vapid.privateJwk) as JsonWebKey,
      ECDSA,
      false,
      ['sign'],
    );
    const publicKey = await crypto.subtle.importKey(
      'raw',
      decodeBase64Url(vapid.publicKey) ?? new Uint8Array(),
      ECDSA,
      false,
      ['verify'],
    );
    const signature = await crypto.subtle.sign({ ...ECDSA, hash: 'SHA-256' }, privateKey, probe);
    if (await crypto.subtle.verify({ ...ECDSA, hash: 'SHA-256' }, publicKey, signature, probe)) {
      return;
    }
  } catch {
    // A key the runtime refuses to import fails the same way as one that signs for another key.
  }
  throw new ChaskiError(
    'validation',
    'Chaski config: channels.push.vapid.privateKey is not the private key of ' +
      'channels.push.vapid.publicKey',
  );
};

// Loads overlap on a busy isolate: one that started earlier and finished later must not put back
// what a newer one already replaced.
let loadsStarted = 0;
let loadsApplied = 0;

const actorOf = (row: SettingsRow): Actor => ({
  id: row.updatedById,
  name: row.updatedByName ?? undefined,
});

export type VapidUpdate = {
  subject?: string;
  publicKey?: string;
  privateKey?: string;
  /** A key pair other than the saved one replaces it only when this confirms it. */
  replace?: boolean;
};

export type ApnsUpdate = {
  teamId?: string;
  keyId?: string;
  privateKey?: string;
  ios?: ApnsAppConfig | null;
  macos?: ApnsAppConfig | null;
};

export class SettingsService extends BaseService {
  protected static override name = 'settings';

  /** Reads every saved section and opens its secret; ready() runs this before each request. */
  static load = async (): Promise<void> => {
    const order = ++loadsStarted;
    const rows = await SettingsService.client.settings.findMany({});
    const { secret } = baseConfig();
    const loaded: Record<string, StoredSection<unknown>> = {};
    for (const row of rows) loaded[row.section] = await readSection(row, secret);
    if (order < loadsApplied) return;
    loadsApplied = order;
    setStoredSettings(loaded as StoredSettings);
  };

  private static row = (section: SettingsSection) =>
    SettingsService.client.settings.findFirst({ where: { section } });

  /**
   * Saves a section as validateConfig will read it: the binding it needs, CHASKI_SECRET when it
   * has a secret, then its fields. A secret left out keeps the saved one.
   */
  private static store = async <S extends SettingsSection>(
    section: S,
    update: Record<string, unknown>,
    actor: Actor,
    options: { secret?: string; check?: (current: Record<string, unknown>) => void } = {},
  ): Promise<void> => {
    const row = await SettingsService.row(section);
    const current = parseJson<Record<string, unknown>>(row?.value, {});
    options.check?.(current);
    const fields = merge(current, update);
    const bindings = SettingsService.bindings;
    requireBinding(section, bindings);

    const field = SECRET_FIELD[section];
    const secret = field ? requireSecret(section) : '';
    let full = fields;
    if (field) {
      let plaintext = options.secret;
      if (plaintext === undefined && row?.secret) {
        const kept = await unseal(secret, section, row.secret);
        if (kept === null) {
          throw new ChaskiError(
            'validation',
            `Chaski config: the saved ${secretField(section)} doesn't decrypt with this ` +
              'CHASKI_SECRET: give it again',
          );
        }
        plaintext = kept;
      }
      full = { ...fields, [field]: plaintext };
    }

    // The muted types are stored as { mutedTypes }, and the config takes the list itself.
    const value = section === 'default_muted_types' ? full.mutedTypes : full;
    let resolved: unknown;
    try {
      resolved = resolveSection(section, value as StoredSections[S], bindings);
    } catch (error) {
      // The binding passed above, so what's left is a field the person saving can fix.
      if (isChaskiError(error) && error.code === 'config') {
        throw new ChaskiError('validation', error.message);
      }
      throw error;
    }
    if (section === 'vapid') await assertKeyPair(resolved as NonNullable<ResolvedPush['vapid']>);
    const sealed =
      !field || options.secret === undefined
        ? (row?.secret ?? null)
        : await seal(secret, section, options.secret);

    await SettingsService.client.settings.upsertMany({
      data: [
        {
          section,
          value: JSON.stringify(fields),
          secret: sealed,
          updatedById: actor.id,
          updatedByName: actor.name ?? null,
        },
      ],
      target: ['section'],
      update: ['value', 'secret', 'updatedById', 'updatedByName', 'updatedAt'],
    });
    await SettingsService.changed(section, actor, 'settings saved');
  };

  private static changed = async (section: SettingsSection, actor: Actor, line: string) => {
    // This isolate reads the change at once; the others on their next request.
    await SettingsService.load();
    SettingsService.log.info(line, { section, actor: actor.id });
    // A template's languages are the Worker's, so its status per language moves with them.
    await publishAdminEvents(section === 'locales' ? ['locales', 'templates'] : ['channels']);
  };

  static saveEmail = (
    update: { from?: string; fromName?: string | null; replyTo?: string | null },
    actor: Actor,
  ) => SettingsService.store('email', update, actor);

  /** In-app has no options: saving it turns it on. */
  static saveInApp = (actor: Actor) => SettingsService.store('in_app', {}, actor);

  static saveVapid = ({ replace = false, privateKey, ...update }: VapidUpdate, actor: Actor) => {
    if ((update.publicKey === undefined) !== (privateKey === undefined)) {
      throw new ChaskiError(
        'validation',
        'give channels.push.vapid.publicKey and channels.push.vapid.privateKey together: they ' +
          'are one key pair',
      );
    }
    return SettingsService.store('vapid', update, actor, {
      secret: privateKey,
      // Every browser subscribed with the saved key, which a new pair leaves unable to receive.
      check: (current) => {
        const saved = current.publicKey;
        if (replace || saved === undefined || update.publicKey === undefined) return;
        if (saved === update.publicKey) return;
        throw new ChaskiError(
          'conflict',
          'web push already has a key pair: browsers subscribed with it stop receiving push ' +
            'until they subscribe again, so confirm with replace: true',
        );
      },
    });
  };

  /** A new P-256 pair, made here so the private key is never anywhere but sealed in D1. */
  static generateVapid = async (
    input: { subject?: string; replace?: boolean },
    actor: Actor,
  ): Promise<void> => {
    const pair = (await crypto.subtle.generateKey(ECDSA, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    await SettingsService.saveVapid(
      {
        subject: input.subject,
        publicKey: encodeBase64Url(new Uint8Array(raw)),
        privateKey: jwk.d,
        replace: input.replace,
      },
      actor,
    );
  };

  static saveApns = ({ privateKey, ...update }: ApnsUpdate, actor: Actor) =>
    SettingsService.store('apns', update, actor, { secret: privateKey });

  static saveFcm = ({ serviceAccount }: { serviceAccount?: string }, actor: Actor) =>
    SettingsService.store('fcm', {}, actor, { secret: serviceAccount });

  static saveWns = (
    { clientSecret, ...update }: { tenantId?: string; clientId?: string; clientSecret?: string },
    actor: Actor,
  ) => SettingsService.store('wns', update, actor, { secret: clientSecret });

  static saveDefaultMutedTypes = (mutedTypes: string[], actor: Actor) =>
    SettingsService.store('default_muted_types', { mutedTypes }, actor);

  /**
   * Saves the Worker's languages whole. Each translation was written from the default content,
   * so the default can change only while no template has one, deleted templates included.
   */
  static saveLocales = async (locales: Locales, actor: Actor): Promise<void> => {
    const translations = await SettingsService.client.templateTranslations.count({ where: {} });
    // Stored canonical, so comparing two defaults is comparing strings; a tag Intl can't read
    // stays as given, for the resolver to name.
    const canonical = (tag: string) => canonicalLocale(tag) ?? tag;
    const defaultLocale = canonical(locales.default);
    const next = {
      default: defaultLocale,
      supported: [...new Set(locales.supported.map(canonical))].filter(
        (locale) => locale !== defaultLocale,
      ),
    };
    await SettingsService.store('locales', next, actor, {
      check: (current) => {
        if (translations === 0 || current.default === undefined) return;
        if (current.default === next.default) return;
        throw new ChaskiError(
          'conflict',
          `the default language stays '${current.default}' while templates have translations ` +
            `(${translations}): each was written from the '${current.default}' content, so ` +
            'delete them before changing it',
        );
      },
    });
  };

  /** The languages as the dashboard edits them, and how many translations lock the default. */
  static locales = async () => {
    const config = SettingsService.config;
    const [row, translations] = await Promise.all([
      SettingsService.row('locales'),
      SettingsService.client.templateTranslations.count({ where: {} }),
    ]);
    return {
      default: config.locales?.default ?? null,
      supported: config.locales?.supported ?? [],
      translations,
      updatedBy: row ? actorOf(row) : null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      problem: config.problems.locales ?? null,
    };
  };

  /** Deleting a channel's section turns it off; deleting a push provider's turns that one off. */
  static remove = async (section: SettingsSection, actor: Actor): Promise<void> => {
    const result = await SettingsService.db.delete(settings).where(eq(settings.section, section));
    if (result.meta.changes === 0) {
      throw new ChaskiError('not_found', `${SECTION_PATH[section]} has no saved settings`);
    }
    await SettingsService.changed(section, actor, 'settings removed');
  };

  /**
   * Every saved section as the dashboard shows it: its plain fields, whether each secret is set
   * (never the secret), who saved it and when, and why it can't be used, if it can't.
   */
  static sections = async () => {
    const config = SettingsService.config;
    const rows = new Map(
      (await SettingsService.client.settings.findMany({})).map((row) => [row.section, row]),
    );
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    const app = (value: unknown) =>
      value && typeof value === 'object' ? (value as ApnsAppConfig) : null;
    const section = <T>(
      name: SettingsSection,
      fields: (saved: Record<string, unknown>, secretSet: boolean) => T,
    ) => {
      const row = rows.get(name);
      if (!row) return null;
      return {
        ...fields(parseJson<Record<string, unknown>>(row.value, {}), Boolean(row.secret)),
        updatedBy: actorOf(row),
        updatedAt: row.updatedAt.toISOString(),
        problem: config.problems[name] ?? null,
      };
    };
    const muted = section('default_muted_types', () => ({}));

    return {
      email: section('email', (saved) => ({
        from: text(saved.from),
        fromName: text(saved.fromName),
        replyTo: text(saved.replyTo),
      })),
      in_app: section('in_app', () => ({})),
      vapid: section('vapid', (saved, privateKeySet) => ({
        subject: text(saved.subject),
        publicKey: text(saved.publicKey),
        privateKeySet,
      })),
      apns: section('apns', (saved, privateKeySet) => ({
        teamId: text(saved.teamId),
        keyId: text(saved.keyId),
        privateKeySet,
        ios: app(saved.ios),
        macos: app(saved.macos),
      })),
      // The project and the account come from the service account itself, once it opens.
      fcm: section('fcm', (_, serviceAccountSet) => ({
        projectId: config.channels.push?.fcm?.projectId ?? null,
        clientEmail: config.channels.push?.fcm?.clientEmail ?? null,
        serviceAccountSet,
      })),
      wns: section('wns', (saved, clientSecretSet) => ({
        tenantId: text(saved.tenantId),
        clientId: text(saved.clientId),
        clientSecretSet,
      })),
      defaultMutedTypes: {
        mutedTypes: config.defaultMutedTypes,
        updatedBy: muted?.updatedBy ?? null,
        updatedAt: muted?.updatedAt ?? null,
        problem: muted?.problem ?? null,
      },
    };
  };
}
