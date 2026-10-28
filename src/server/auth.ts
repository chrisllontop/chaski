import type { Context, Env } from 'hono';
import { ChaskiError } from '../contract/errors';
import { decodeBase64Url } from './lib/base64';
import { logger } from './lib/log';
import { isApi } from './routes/dashboard';

/** Who is using the dashboard; admin actions are logged under this id. */
export type Actor = {
  id: string;
  name?: string;
};

/**
 * Decides who may use the dashboard and its API: an Actor lets the request
 * in, null answers 403, and a Response (a redirect to a login page, say) is
 * returned as is.
 */
export type Authorize<E extends Env = Env> = (
  c: Context<E>,
) => Actor | null | Response | Promise<Actor | null | Response>;

/**
 * Whether the actor may pause channels, and send or discard what a paused channel holds. Without
 * it nobody may: stopping a channel stops password resets with it.
 */
export type CanPauseChannels<E extends Env = Env> = (
  c: Context<E>,
  actor: Actor,
) => boolean | Promise<boolean>;

const log = logger('auth');

const actors = new WeakMap<Request, Actor>();
const pausePermissions = new WeakMap<Request, () => boolean | Promise<boolean>>();

export const isActor = (value: unknown): value is Actor =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Actor).id === 'string' &&
  (value as Actor).id.length > 0;

export const setActor = (c: Context, actor: Actor): void => {
  actors.set(c.req.raw, actor);
};

/** The actor authorize let in; the guard runs before every admin route. */
export const actorOf = (c: Context): Actor | undefined => actors.get(c.req.raw);

export const setPausePermission = (c: Context, check: () => boolean | Promise<boolean>): void => {
  pausePermissions.set(c.req.raw, check);
};

export const mayPauseChannels = async (c: Context): Promise<boolean> =>
  (await pausePermissions.get(c.req.raw)?.()) ?? false;

// ─── Cloudflare Access ───

type AccessClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  sub?: string;
  email?: string;
  common_name?: string;
};

// Access rotates its signing keys every six weeks and publishes the next one
// ahead of time, so keys are fetched again after a while and whenever a token
// names a key this isolate has not seen.
const KEYS_TTL_MS = 10 * 60_000;
const keyCache = new Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }>();

const loadKeys = async (issuer: string, refresh: boolean): Promise<Map<string, CryptoKey>> => {
  const cached = keyCache.get(issuer);
  if (cached && !refresh && Date.now() - cached.fetchedAt < KEYS_TTL_MS) return cached.keys;

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs answered ${response.status}`);
  const { keys } = (await response.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const imported = new Map<string, CryptoKey>();
  for (const jwk of keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    imported.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  keyCache.set(issuer, { keys: imported, fetchedAt: Date.now() });
  return imported;
};

const decodeJson = <T>(part: string): T | null => {
  const bytes = decodeBase64Url(part);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
};

const verifyAccessToken = async (
  token: string,
  issuer: string,
  audiences: string[],
): Promise<AccessClaims | null> => {
  const [headerPart, claimsPart, signaturePart, extra] = token.split('.');
  if (!headerPart || !claimsPart || !signaturePart || extra !== undefined) return null;
  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
  const claims = decodeJson<AccessClaims>(claimsPart);
  const signature = decodeBase64Url(signaturePart);
  if (header?.alg !== 'RS256' || !header.kid || !claims || !signature) return null;

  const key =
    (await loadKeys(issuer, false)).get(header.kid) ??
    (await loadKeys(issuer, true)).get(header.kid);
  if (!key) return null;
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    new TextEncoder().encode(`${headerPart}.${claimsPart}`),
  );
  if (!valid) return null;

  const now = Date.now() / 1000;
  const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer) return null;
  if (!tokenAudiences.some((aud) => aud !== undefined && audiences.includes(aud))) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > now) return null;
  return claims;
};

/**
 * Lets in whoever Cloudflare Access let through: it verifies the signed
 * `Cf-Access-Jwt-Assertion` header against the team's keys, the application
 * audience (AUD tag), the issuer and the expiry.
 */
export const cloudflareAccess = (options: {
  /** The team domain, e.g. `myteam.cloudflareaccess.com`. */
  teamDomain: string;
  /** The Access application's AUD tag, or several. */
  audience: string | string[];
}) => {
  const issuer = new URL(
    options.teamDomain.includes('://') ? options.teamDomain : `https://${options.teamDomain}`,
  ).origin;
  const audiences = [options.audience].flat().filter(Boolean);
  if (audiences.length === 0) {
    throw new ChaskiError('config', 'Chaski config: cloudflareAccess needs an audience');
  }
  // Generic in the env, so it fits chaski.routes<E>() of a host that types its app and can be
  // called with that host's context; Hono's Context is invariant in its env.
  return async <E extends Env>(c: Context<E>): Promise<Actor | null> => {
    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) return null;
    try {
      const claims = await verifyAccessToken(token, issuer, audiences);
      const id = claims?.email ?? claims?.common_name ?? claims?.sub;
      return id ? { id, name: claims?.email } : null;
    } catch (error) {
      log.error('Access token check failed', error);
      return null;
    }
  };
};

// ─── Basic auth ───

const digest = async (value: string) =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

// Comparing digests keeps the time independent of where the values differ
// and of their lengths.
const safeEqual = async (a: string, b: string): Promise<boolean> => {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  return crypto.subtle.timingSafeEqual(left, right);
};

const decodeCredentials = (header: string | undefined): [string, string] | null => {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0)),
    );
    const at = decoded.indexOf(':');
    return at < 0 ? null : [decoded.slice(0, at), decoded.slice(at + 1)];
  } catch {
    return null;
  }
};

/** One username and password, checked in constant time; the browser asks for them. */
export const basicAuth = (options: { username: string; password: string; realm?: string }) => {
  if (!options.username || !options.password) {
    throw new ChaskiError('config', 'Chaski config: basicAuth needs a username and a password');
  }
  const challenge = `Basic realm="${options.realm ?? 'Chaski'}", charset="UTF-8"`;
  // Generic in the env for the same reason as cloudflareAccess.
  return async <E extends Env>(c: Context<E>): Promise<Actor | Response> => {
    const [username, password] = decodeCredentials(c.req.header('authorization')) ?? ['', ''];
    // Both comparisons always run, so the answer time doesn't tell which failed.
    const [userMatches, passwordMatches] = await Promise.all([
      safeEqual(username, options.username),
      safeEqual(password, options.password),
    ]);
    if (userMatches && passwordMatches) return { id: options.username };
    c.header('www-authenticate', challenge);
    return isApi(c)
      ? c.json({ error: 'unauthorized', message: 'credentials required' }, 401)
      : c.text('Unauthorized', 401);
  };
};
