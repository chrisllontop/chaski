import { type Env, Hono, type MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type ChaskiErrorCode, isChaskiError } from '../../contract/errors';
import { type Authorize, isActor, setActor } from '../auth';
import { resolveConfig } from '../config';
import { logger } from '../lib/log';
import { reportError } from '../lib/report-error';
import { ready } from '../migrations';
import { admin } from './admin';
import { isApi, serveAsset, serveShell } from './dashboard';
import { tracking } from './tracking';

export type RoutesOptions<E extends Env = Env> = {
  dashboard: {
    authorize: Authorize<E>;
  };
};

const ERROR_STATUS: Record<ChaskiErrorCode, ContentfulStatusCode> = {
  validation: 400,
  config: 500,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
};

const log = logger('http');

// Fail-closed: only an actor with an id lets the request through.
const guard =
  <E extends Env>(authorize: Authorize<E>): MiddlewareHandler<E> =>
  async (c, next) => {
    const verdict = await authorize(c);
    if (verdict instanceof Response) {
      return verdict;
    }
    c.header('Cache-Control', 'no-store');
    if (isActor(verdict)) {
      setActor(c, verdict);
      return next();
    }
    return isApi(c)
      ? c.json({ error: 'forbidden', message: 'not allowed' }, 403)
      : c.text('Forbidden', 403);
  };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Session cookies ride along on cross-site requests, and a WebSocket upgrade
// escapes CORS altogether, so a write or an upgrade from another origin is
// refused before authorize sees it. Browsers always send Origin on both;
// a request without one comes from a server-side client.
const sameOrigin: MiddlewareHandler = async (c, next) => {
  const upgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket';
  if (SAFE_METHODS.has(c.req.method) && !upgrade) return next();
  const origin = c.req.header('origin');
  if (origin === undefined && c.req.header('sec-fetch-site') !== 'cross-site') return next();
  const allowed = [new URL(c.req.url).origin, new URL(resolveConfig().publicUrl).origin];
  if (origin !== undefined && allowed.includes(origin)) return next();
  return c.json({ error: 'forbidden', message: 'cross-origin request refused' }, 403);
};

// Not chained: each chained call rewrites the app's type, which then no longer matches `Hono<E>`.
export const mountRoutes = <E extends Env = Env>({ dashboard }: RoutesOptions<E>): Hono<E> => {
  const app = new Hono<E>();
  app.onError((error, c) => {
    if (isChaskiError(error)) {
      if (error.code === 'internal' || error.code === 'config') {
        reportError(error, { source: 'http' });
        log.error('request failed', error, { code: error.code });
      }
      return c.json({ error: error.code, message: error.message }, ERROR_STATUS[error.code]);
    }
    reportError(error, { source: 'http' });
    log.error('unhandled error', error);
    return c.json({ error: 'internal', message: 'internal error' }, 500);
  });
  // Registered before the guard on purpose: Hono runs handlers in registration order. The assets
  // ship in the npm package, and email clients load the open pixel without credentials.
  app.get('/assets/*', serveAsset);
  app.route('/t', tracking);
  app.use('/api/*', sameOrigin);
  app.use(guard(dashboard.authorize));
  app.use('/api/*', async (_c, next) => {
    await ready();
    await next();
  });
  app.route('/api', admin);
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404));
  app.get('*', serveShell);
  return app;
};
