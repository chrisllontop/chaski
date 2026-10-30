import { Hono, type MiddlewareHandler } from 'hono';
import { setActor } from '../auth';
import { admin } from './admin';
import { isApi, serveAsset, serveShell } from './dashboard';
import { handleError, requireReady, sameOrigin } from './http';

const ACCESS_OFF_PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chaski needs Cloudflare Access</title>
<style>body{margin:0;display:grid;min-height:100vh;place-items:center;font:15px/1.6 system-ui,sans-serif;color:#0a0a0a;background:#fafafa}main{max-width:34rem;padding:2rem}h1{font-size:1.25rem}code{font:13px ui-monospace,monospace}@media (prefers-color-scheme:dark){body{color:#fafafa;background:#0a0a0a}}</style>
<main>
<h1>Chaski needs Cloudflare Access</h1>
<p>This dashboard opens only for people Cloudflare Access signs in. In the Cloudflare dashboard, open this Worker, go to <strong>Settings</strong> › <strong>Domains &amp; Routes</strong> and select <strong>Enable Cloudflare Access</strong> on its workers.dev URL. A custom domain needs an Access application of its own, in Zero Trust.</p>
<p>On your machine, <code>wrangler dev</code> signs you in with the identity under <code>access.dev</code> in wrangler.jsonc.</p>
</main>
</html>`;

// Access signs people in before their request reaches the Worker and hands the Worker who they
// are in ctx.access, so a request without it came through a URL Access doesn't cover. Nothing gets
// past without an identity, wrangler dev included: it signs in the one under access.dev.
const access: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const identity = await (c.executionCtx as ExecutionContext).access?.getIdentity();
  const id = identity?.email ?? identity?.user_uuid;
  if (identity && id) {
    setActor(c, { id, name: identity.name ?? identity.email });
    return next();
  }
  return isApi(c)
    ? c.json({ error: 'forbidden', message: 'turn on Cloudflare Access for this Worker' }, 403)
    : c.html(ACCESS_OFF_PAGE, 403, {
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
};

/** The dashboard and its admin API, the Chaski Worker's own URL; Cloudflare Access guards both. */
export const dashboard = (): Hono => {
  // Not chained: each chained call rewrites the app's type.
  const app = new Hono();
  app.onError(handleError);
  // Before the guard: the assets ship in the npm package and hold nothing of this Worker's.
  app.get('/assets/*', serveAsset);
  app.use('/api/*', sameOrigin);
  app.use(access);
  app.use('/api/*', requireReady);
  app.route('/api', admin);
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404));
  app.get('*', serveShell);
  return app;
};
