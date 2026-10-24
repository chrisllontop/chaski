import { type Context, type Env, Hono, type MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type ChaskiErrorCode, isChaskiError } from '../../contract/errors';
import { logger } from '../lib/log';
import { reportError } from '../lib/report-error';
import { ready } from '../migrations';
import { isApi, serveAsset, serveShell } from './dashboard';

export type Authorize<E extends Env = Env> = (
  c: Context<E>,
) => boolean | Response | Promise<boolean | Response>;

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

// Fail-closed: only a literal true lets the request through.
const guard =
  <E extends Env>(authorize: Authorize<E>): MiddlewareHandler<E> =>
  async (c, next) => {
    const verdict = await authorize(c);
    if (verdict instanceof Response) {
      return verdict;
    }
    c.header('Cache-Control', 'no-store');
    if (verdict === true) {
      return next();
    }
    return isApi(c) ? c.json({ error: 'forbidden' }, 403) : c.text('Forbidden', 403);
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
  // Registered before the guard on purpose: Hono runs handlers in registration order, and the
  // assets are public anyway because they ship in the npm package.
  app.get('/assets/*', serveAsset);
  app.use(guard(dashboard.authorize));
  app.use('/api/*', async (_c, next) => {
    await ready();
    await next();
  });
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404));
  app.get('*', serveShell);
  return app;
};
