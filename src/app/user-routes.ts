import { type Context, type Env, Hono, type MiddlewareHandler } from 'hono';
import { basePath } from 'hono/route';
import { RECIPIENT_HEADER } from '../contract/api';
import { logger } from '../server/lib/log';

/** The app's service binding to Chaski's ChaskiEntrypoint, or anything that fetches like it. */
export type ChaskiService = { fetch(request: Request): Promise<Response> };

/**
 * Says who is signed in: the contact id Chaski keys their feed, devices and preferences by. null
 * answers 401, and a Response is returned as is.
 */
export type Identify<E extends Env = Env> = (
  c: Context<E>,
) => string | null | Response | Promise<string | null | Response>;

export const USER_ROUTE_GROUPS = ['feed', 'push', 'preferences'] as const;
export type UserRouteGroup = (typeof USER_ROUTE_GROUPS)[number];

export type UserRoutesOptions<E extends Env = Env> = {
  /** Where Chaski is: the app's service binding to it, such as `(c) => c.env.CHASKI`. */
  chaski: (c: Context<E>) => ChaskiService;
  identify: Identify<E>;
  /**
   * Origins of the app's own frontend, when it lives on another origin than these routes; writes
   * and socket upgrades from any other origin are refused.
   */
  allowedOrigins?: string[];
  /**
   * The groups of routes this mount serves, all three by default. A shared inbox serves the feed
   * alone: a browser belongs to one contact, so registering it there would take it from the
   * user's own inbox. An app with a preferences API of its own leaves `preferences` out.
   */
  groups?: UserRouteGroup[];
  /** Whether the signed-in contact may register a device; false answers 403. */
  allowPush?: (c: Context<E>, recipientId: string) => boolean | Promise<boolean>;
};

const log = logger('user-routes');

// What Chaski reads of the browser's request: the body's type, the user agent a device keeps and
// the socket upgrade. The app's cookies and credentials stay in the app.
const FORWARDED_HEADERS = ['content-type', 'user-agent', 'upgrade'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const NO_STORE = { 'Cache-Control': 'no-store' };

// Session cookies ride along on cross-site requests, and a WebSocket upgrade escapes CORS
// altogether, so a write or an upgrade from an origin other than the request's own or a listed
// one is refused. Browsers always send Origin on both; a request without one is server-side.
const sameOrigin =
  (allowedOrigins: string[]): MiddlewareHandler =>
  async (c, next) => {
    const upgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket';
    if (SAFE_METHODS.has(c.req.method) && !upgrade) return next();
    const origin = c.req.header('origin');
    if (origin === undefined && c.req.header('sec-fetch-site') !== 'cross-site') return next();
    if (origin !== undefined && [new URL(c.req.url).origin, ...allowedOrigins].includes(origin)) {
      return next();
    }
    return c.json({ error: 'forbidden', message: 'cross-origin request refused' }, 403);
  };

const relativePath = (c: Context): string =>
  c.req.path.slice(basePath(c).replace(/\/$/, '').length);

// A new request, not the browser's: Chaski reads the contact from RECIPIENT_HEADER, so a copy the
// browser sent must never reach it.
const forward = async (c: Context, chaski: ChaskiService, recipientId: string | null) => {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = c.req.header(name);
    if (value !== undefined) headers.set(name, value);
  }
  if (recipientId !== null) headers.set(RECIPIENT_HEADER, recipientId);
  const url = new URL(c.req.url);
  const request = new Request(`https://chaski${relativePath(c)}${url.search}`, {
    method: c.req.method,
    headers,
    body: SAFE_METHODS.has(c.req.method) ? null : c.req.raw.body,
  });
  try {
    return await chaski.fetch(request);
  } catch (error) {
    log.error('Chaski did not answer', error, { path: relativePath(c) });
    return c.json({ error: 'internal', message: 'Chaski did not answer' }, 502);
  }
};

/**
 * The routes the app's frontend calls for the signed-in user, which `chaskijs/client` wraps,
 * plus the open pixel of Chaski's emails; mount them with app.route() and point
 * CHASKI_PUBLIC_URL at the mount. Each request goes to Chaski over the service binding.
 */
export const userRoutes = <E extends Env = Env>({
  chaski,
  identify,
  allowedOrigins = [],
  groups = [...USER_ROUTE_GROUPS],
  allowPush,
}: UserRoutesOptions<E>): Hono<E> => {
  // Not chained: chaining rewrites the app's type.
  const app = new Hono<E>();
  app.get('/t/o/:deliveryId', (c) => forward(c, chaski(c), null));
  // Scoped to the groups this mount serves, with no catch-all after them: a mount nested under
  // this one's path (/inbox/team under /inbox) never runs this identify, in whichever order the
  // app registers them, and a path no mount serves reaches the app's own 404.
  for (const group of new Set(groups)) {
    app.use(`/${group}/*`, sameOrigin(allowedOrigins));
    app.all(`/${group}/*`, async (c) => {
      const recipientId = await identify(c);
      if (recipientId instanceof Response) return recipientId;
      // Chaski marks its own answers no-store; these two never reach it.
      if (typeof recipientId !== 'string' || recipientId.length === 0 || recipientId.length > 256) {
        return c.json({ error: 'unauthorized', message: 'not signed in' }, 401, NO_STORE);
      }
      const registers = c.req.method === 'POST' && relativePath(c) === '/push/subscriptions';
      if (registers && allowPush && !(await allowPush(c, recipientId))) {
        return c.json(
          { error: 'forbidden', message: 'this contact may not register devices' },
          403,
          NO_STORE,
        );
      }
      return forward(c, chaski(c), recipientId);
    });
  }
  return app;
};
