import { type Context, type Env, Hono, type MiddlewareHandler } from 'hono';
import { basePath } from 'hono/route';
import { assets, shell } from './generated/dashboard';

export type Authorize<E extends Env = Env> = (
  c: Context<E>,
) => boolean | Response | Promise<boolean | Response>;

export type RoutesOptions<E extends Env = Env> = {
  dashboard: {
    authorize: Authorize<E>;
  };
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

// The host picks the mount path in app.route(), so chaski reads it per request instead of asking
// for it twice. A parameterized mount resolves to the concrete path.
const mountPath = (c: Context) => basePath(c).replace(/\/$/, '');

const relativePath = (c: Context) => c.req.path.slice(mountPath(c).length);

const isApi = (c: Context) => {
  const path = relativePath(c);
  return path === '/api' || path.startsWith('/api/');
};

const escapeAttribute = (value: string) =>
  value.replace(/[&"<>]/g, (character) => `&#${character.charCodeAt(0)};`);

const decodeBase64 = (body: string) => Uint8Array.from(atob(body), (c) => c.charCodeAt(0));

const serveAsset = (c: Context) => {
  const asset = assets[relativePath(c).slice(1)];
  if (!asset) {
    return c.text('Not found', 404);
  }
  return c.body(asset.base64 ? decodeBase64(asset.body) : asset.body, 200, {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': asset.type,
    'X-Content-Type-Options': 'nosniff',
  });
};

// Vite builds with relative URLs; the base element resolves them against the mount path, so deep
// links load the same assets as the root.
const serveShell = (c: Context) =>
  c.html(shell.replace('<head>', `<head><base href="${escapeAttribute(mountPath(c))}/">`), 200, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': contentSecurityPolicy,
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  });

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
export const routes = <E extends Env = Env>({ dashboard }: RoutesOptions<E>): Hono<E> => {
  const app = new Hono<E>();
  // Registered before the guard on purpose: Hono runs handlers in registration order, and the
  // assets are public anyway because they ship in the npm package.
  app.get('/assets/*', serveAsset);
  app.use(guard(dashboard.authorize));
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  app.get('*', serveShell);
  return app;
};
