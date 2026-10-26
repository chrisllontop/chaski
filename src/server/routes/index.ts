import { type Env, Hono, type MiddlewareHandler } from 'hono';
import { type Authorize, isActor, setActor } from '../auth';
import { admin } from './admin';
import { isApi, serveAsset, serveShell } from './dashboard';
import { handleError, requireReady, sameOrigin } from './http';
import { tracking } from './tracking';

export type RoutesOptions<E extends Env = Env> = {
  dashboard: {
    authorize: Authorize<E>;
  };
};

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

// Not chained: each chained call rewrites the app's type, which then no longer matches `Hono<E>`.
export const mountRoutes = <E extends Env = Env>({ dashboard }: RoutesOptions<E>): Hono<E> => {
  const app = new Hono<E>();
  app.onError(handleError);
  // Registered before the guard on purpose: Hono runs handlers in registration order. The assets
  // ship in the npm package, and email clients load the open pixel without credentials.
  app.get('/assets/*', serveAsset);
  app.route('/t', tracking);
  app.use('/api/*', sameOrigin());
  app.use(guard(dashboard.authorize));
  app.use('/api/*', requireReady);
  app.route('/api', admin);
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404));
  app.get('*', serveShell);
  return app;
};
