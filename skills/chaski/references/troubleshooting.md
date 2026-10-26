# Troubleshoot Chaski

Find the symptom, apply the fix, then run the check that failed again. Chaski’s errors are
`ChaskiError`s with a `code`; its routes answer them as `{ "error": "<code>", "message": "…" }`,
and `config` errors answer 500. The message names what to change, so read it whole. Error codes:
https://chaski.sh/docs/errors.

## Config errors

Chaski checks the config on every call. The message starts with `Chaski config:`.

| Message | Fix |
| --- | --- |
| `publicUrl must be the absolute http(s) URL where Chaski is mounted` | `CHASKI_PUBLIC_URL` is unset or relative. Locally it comes from `.dev.vars`, deployed from `vars`. |
| `bindings.db is missing`, `bindings.queue is missing` | The name in `env.X` doesn’t match the binding in the Wrangler config, or the binding isn’t declared. |
| `channels.email is configured but bindings.email is missing` | Declare `send_email` and pass it as `bindings.email`, or drop `channels.email`. |
| `channels.email.from must be an email address` | Set `from` to an address on the domain onboarded to Email Service. |
| `channels.in_app is configured but bindings.feed is missing` | Bind the `ChaskiFeed` Durable Object and pass it as `bindings.feed`. |
| `channels.push needs vapid (web push), apns (iOS) or both` | Fill in `vapid`, `apns` or both, or drop `channels.push`. |
| `channels.push.vapid.subject must be a mailto: or https: URL` | Use `mailto:you@example.com` or an `https://` URL. |
| `channels.push.vapid.publicKey must be a base64url uncompressed P-256 key (65 bytes)` | Use the `publicKey` that `npx web-push generate-vapid-keys` prints, not a PEM. An empty value means the var is unset. |
| `channels.push.vapid.privateKey must be a base64url P-256 private key (32 bytes)` | Same, for `privateKey`. Locally the secret comes from `.dev.vars`; deployed, from `wrangler secret put`. |
| `channels.push.apns.<field> is required`, `…environment must be 'sandbox' or 'production'`, `…privateKey must be the contents of the .p8 file` | Fill in the APNs fields; `privateKey` is the whole `.p8` text, `-----BEGIN PRIVATE KEY-----` included. |
| `maxRetries must be a non-negative integer`, `migrationsTable must be a plain table name` | Fix the option, or leave it out for the default. |
| `bindings.scheduler is missing; chaski.schedule() needs the ChaskiScheduler Workflow` | Bind the Workflow as `scheduler` and export `ChaskiScheduler` from the main module. |
| `cloudflareAccess needs an audience` | Pass the Access application’s AUD tag as `audience`. |
| `basicAuth needs a username and a password` | The secrets are unset in this env: `.dev.vars` locally, `wrangler secret put` deployed. |

`Chaski is not configured: call createChaski() in your Worker's main module` means nothing ran
`createChaski()` before Chaski was called: the module that calls it isn’t imported, directly or
through another module, by the main module.

`email attachments need bindings.attachments (an R2 bucket)` comes from a send with
`email.attachments`; bind an R2 bucket as `attachments`.

## Migrations

`Chaski: the database is missing migrations <files>. Apply them with wrangler d1 migrations apply <database>, with migrations_dir set to node_modules/chaski/migrations.`

- Local and remote are different databases: `--local` for `wrangler dev`, `--remote` for the
  deployed Worker (with the user’s go-ahead).
- A new `database_id` means a new, empty local database; apply again.
- After a Chaski upgrade, new files arrive in `node_modules/chaski/migrations`; apply again.
- `wrangler d1 migrations apply` reports nothing to apply while Chaski still complains: the
  binding’s `migrations_dir` points somewhere other than the package’s folder (the host’s own
  migrations, a path that doesn’t resolve in a monorepo), or Chaski shares a database with the
  host. Chaski needs a database of its own, with `migrations_dir` reaching
  `chaski/migrations` from the Wrangler config’s folder.
- A custom `migrations_table` on the D1 binding needs the same name in `migrationsTable`.

## Build and deploy

| Wrangler says | Fix |
| --- | --- |
| `Your Worker depends on the following Durable Objects, which are not exported in your entrypoint file: ChaskiFeed.` | Export `ChaskiFeed` (and `ChaskiEvents`) from the main module: `export { ChaskiEvents, ChaskiFeed } from 'chaski';`. |
| `Your Worker depends on the following Workflows, which are not exported in your entrypoint file: ChaskiScheduler.` | Export `ChaskiScheduler` from the main module. |
| An error about a Durable Object migration tag | Chaski’s `migrations` entry goes after the Worker’s existing ones with a tag of its own; entries already deployed never change. |

`npx wrangler deploy --dry-run --outdir /tmp/chaski-dry-run` catches all three without deploying.

Type errors:

- `Context<…>` isn’t assignable to `Context<Env…>` where `authorize` calls `basicAuth()` or
  `cloudflareAccess()`: call `chaski.routes()` without a type argument and type the context as
  Hono’s `Context`, casting `c.env` to the Worker’s `Env` ([setup.md](setup.md), step 5).
- A build error that `hono/route` can’t be resolved: `hono` is older than 4.8, the first version
  with that module.
- Errors from another Worker over RPC arrive without their `code`: both Workers need a
  `compatibility_date` on or after `2026-04-21`.

## Sends and deliveries

| The send throws | Fix |
| --- | --- |
| `unknown notification type '<type>': register a template for it before sending` | Create the template, or import it ([sending.md](sending.md)). |
| `channels not configured: <channels>` | The send’s `channels` lists a channel the config doesn’t turn on. |
| `scheduledAt must be ISO 8601 with an explicit offset (Z or ±hh:mm)` | Add the offset: `2026-11-01T09:00:00-05:00` or `…Z`. |
| `scheduledAt is in the past` | The time passed more than five minutes ago. |

A delivery skipped at send time carries its reason:

| `reason` | Means |
| --- | --- |
| `channel_not_configured` | The config doesn’t turn the channel on, such as a scheduled send firing after the channel left the config. |
| `muted_by_preferences` | The contact turned the channel off or muted the type. `transactional: true` sends anyway, for the flows that must arrive. |
| `missing_email` | The send’s `recipient` has no `email`. |
| `no_device_tokens` | The contact has no registered browser or device: push was never enabled for that `recipient.id`. |
| `no_template` | The template has no enabled content for that channel. Expected when a type uses fewer channels than the config turns on. |

A send whose `outcome` is `suppressed` was skipped everywhere by preferences; `undeliverable`
was skipped everywhere for one of the other reasons.

**Deliveries stay `pending`.** Nothing consumes the queue. Check that the Wrangler config has a
`queues.consumers` entry for the same queue as Chaski’s producer, that the default export has a
`queue` handler, and that the handler awaits `chaski.queue(batch, env, ctx)` before anything else
handles the batch. Chaski leaves alone a batch that holds anything other than its own deliveries,
so its queue must be its own.

**Deliveries `failed` or `dead`.** **Deliveries** in the dashboard shows each attempt’s error. A
template Liquid can’t render or a misconfigured channel fails at once; a provider error retries
with backoff until `maxRetries`, then the delivery is `dead`. Fix the cause, then replay it from
the dashboard. Keep `max_retries` on the queue consumer equal to `maxRetries` (5 by default), or
rows can stay `pending` after the queue gave up on them.

**Nothing arrives, yet deliveries show `sent`.** `dryRun` is on: in dry run Chaski records email
and push without handing them to a provider. Check `GET <mount>/api/channels`, or the dashboard’s
**Channels** page, for `"dryRun"`. In-app items reach the feed in dry run too.

**Web push stopped reaching browsers after a key change.** A subscription belongs to the VAPID key
it was made with. Put the earlier pair back, or have users turn push on again.

## Sign-in

- **Dashboard answers 403 under `wrangler dev` with `cloudflareAccess()`.** Access doesn’t sit in
  front of `wrangler dev`. Let a local session through with a variable only `.dev.vars` sets
  ([setup.md](setup.md), step 5).
- **Dashboard answers 403 in production with `cloudflareAccess()`.** The Access application
  doesn’t cover the mount path, `audience` isn’t that application’s AUD tag, or `teamDomain` is
  another team’s.
- **The browser keeps asking for a password with `basicAuth()`.** The username or password
  doesn’t match the secrets of that env.
- **User routes answer 401 `not signed in`.** `identify` returned `null`: the session middleware
  is registered after the `.route()` call or on another path, or the session cookie didn’t come
  along (a frontend on another origin needs `credentials: 'include'`; see
  [browser-clients.md](browser-clients.md)).
- **403 `cross-origin request refused`.** A write or a socket upgrade came from an origin Chaski
  doesn’t know. It accepts the request’s own origin, `publicUrl`’s and those in the user routes’
  `allowedOrigins`.
- **The browser blocks the user routes’ responses from another origin.** Chaski adds no CORS
  headers; register Hono’s `cors()` with `credentials: true` for that path
  ([browser-clients.md](browser-clients.md)).

## Content-Security-Policy

- **The dashboard loads unstyled, dialogs misbehave, or the console reports CSP violations.** The
  host’s headers overwrote the dashboard’s. `curl -sI <mount>/` must show a policy with
  `style-src 'self' 'nonce-…'`. Skip the mount path in the host’s header middleware
  ([setup.md](setup.md), step 5).
- **The email preview in the template editor stays blank.** The preview document must be framed by
  the dashboard; a host `X-Frame-Options: DENY` or `frame-ancestors 'none'` on that path blocks
  it. Same fix.
- **The frontend’s feed doesn’t update live.** Its `connect-src` must allow the user routes’
  origin and its `wss://` counterpart when they’re on another origin. The client falls back to
  checking once a minute, so the feed still updates, late.
