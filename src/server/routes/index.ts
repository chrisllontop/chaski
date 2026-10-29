import { type Env, Hono, type MiddlewareHandler } from 'hono';
import {
  type Actor,
  type Authorize,
  type CanPauseChannels,
  isActor,
  setActor,
  setPausePermission,
} from '../auth';
import { LOCAL_ENVIRONMENT, resolveConfig } from '../config';
import { logger } from '../lib/log';
import { admin } from './admin';
import { isApi, serveAsset, serveShell } from './dashboard';
import { handleError, requireReady, sameOrigin } from './http';
import { tracking } from './tracking';

export type RoutesOptions<E extends Env = Env> = {
  dashboard: {
    authorize: Authorize<E>;
    canPauseChannels?: CanPauseChannels<E>;
  };
};

const log = logger('auth');

const LOCAL_ACTOR: Actor = { id: 'local', name: 'Local development' };
let warnedLocal = false;

// A config that doesn't validate isn't local: authorize decides, and only then does requireReady
// answer with the config error, so it never reaches someone the dashboard doesn't let in.
const isLocal = (): boolean => {
  try {
    return resolveConfig().environment === LOCAL_ENVIRONMENT;
  } catch {
    return false;
  }
};

// Fail-closed: only an actor with an id lets the request through. In the local environment
// nobody signs in, and pausing only holds the email of this machine, so both hooks are skipped.
const guard =
  <E extends Env>(
    authorize: Authorize<E>,
    canPauseChannels: CanPauseChannels<E> | undefined,
  ): MiddlewareHandler<E> =>
  async (c, next) => {
    if (isLocal()) {
      // Once per isolate, so a deploy that runs as local shows up in its logs.
      if (!warnedLocal) {
        warnedLocal = true;
        log.warn("dashboard open without authorize: the environment is 'local'");
      }
      c.header('Cache-Control', 'no-store');
      setActor(c, LOCAL_ACTOR);
      setPausePermission(c, () => true);
      return next();
    }
    const verdict = await authorize(c);
    if (verdict instanceof Response) {
      return verdict;
    }
    c.header('Cache-Control', 'no-store');
    if (isActor(verdict)) {
      setActor(c, verdict);
      if (canPauseChannels) setPausePermission(c, () => canPauseChannels(c, verdict));
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
  app.use(guard(dashboard.authorize, dashboard.canPauseChannels));
  app.use('/api/*', requireReady);
  app.route('/api', admin);
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404));
  app.get('*', serveShell);
  return app;
};
