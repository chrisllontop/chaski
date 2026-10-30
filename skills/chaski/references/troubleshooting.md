# Troubleshoot Chaski

Find the symptom, apply the fix, then run the check that failed again. Chaski’s errors are
`ChaskiError`s with a `code`; its routes answer them as `{ "error": "<code>", "message": "…" }`,
and `config` errors answer 500. The message names what to change, so read it whole. Error codes:
https://chaski.sh/docs/errors.

## See the error without sending

`env.CHASKI.ready()` checks the setup and the applied migrations and changes nothing: call it from
the app’s health route, or from a temporary route locally ([setup.md](setup.md), step 6). It throws
the `config` error a send would, and answers `{ channels, paused, environment, templates }`:
`channels` lists the channels whose settings are saved, `paused` the paused ones, `environment` the
`CHASKI_ENVIRONMENT` of the Worker that answered, and `templates` at `0` means every send will be
refused as an unknown type: load the template file ([sending.md](sending.md)).

## Config errors

Chaski checks its setup on every call, in the environment that answered. Its messages start with
`Chaski config:`.

| Message | Fix |
| --- | --- |
| `Chaski config: the CHASKI_DB binding is missing`, `Chaski config: the CHASKI_QUEUE binding is missing` | The Chaski project’s `wrangler.jsonc` doesn’t declare it under that exact name for this environment. An `env` block declares every binding again, since Wrangler doesn’t carry them into it. |
| `Chaski config: CHASKI_PUBLIC_URL must be the absolute http(s) URL where the app mounts userRoutes()` | Set the mount’s full URL (`https://app.example.com/me/notifications`), or remove the var: a relative path or a placeholder fails. Locally it comes from `.dev.vars`. |
| `Chaski config: the CHASKI_SCHEDULER binding is missing; schedule() needs the ChaskiScheduler Workflow` | Declare the Workflow as `CHASKI_SCHEDULER`, with a name of its own in each environment. |
| `Chaski config: the CHASKI_FEED binding is missing` | Bind the `ChaskiFeed` Durable Object as `CHASKI_FEED`, and list it in the Durable Object `migrations`. |
| `Chaski config: channels.email is configured but the CHASKI_EMAIL binding is missing` | Declare `send_email` as `CHASKI_EMAIL`, or remove the email settings on **Channels**. |
| `Chaski config: channels.in_app is configured but the CHASKI_FEED binding is missing` | Bind `ChaskiFeed` as `CHASKI_FEED`, or turn in-app off on **Channels**. |
| `email attachments need the CHASKI_ATTACHMENTS binding (an R2 bucket)` | A send carried `email.attachments`: bind an R2 bucket as `CHASKI_ATTACHMENTS`. |

A message that names `channels.<channel>.<field>` points at a setting saved on the dashboard’s
**Channels** page, in that environment: correct it there. After `Chaski config:`:

| Message | The setting |
| --- | --- |
| `channels.email.from must be an email address` | Email’s sender address. |
| `channels.push needs vapid (web push), apns (iOS, macOS), fcm (Android), wns (Windows) or several of them` | Push, with none of its four set up. |
| `channels.push.vapid.subject must be a mailto: or https: URL` | Web push’s subject. |
| `channels.push.vapid.publicKey must be a base64url uncompressed P-256 key (65 bytes)`, `channels.push.vapid.privateKey must be a base64url P-256 private key (32 bytes)` | Web push’s key pair: generate one there, or paste the raw base64url pair web-push tools print, not PEM. |
| `channels.push.apns.teamId is required`, `channels.push.apns.keyId is required`, `channels.push.apns.privateKey must be the contents of the .p8 file` | APNs’ team id, key id and key: the whole `.p8` text, `-----BEGIN PRIVATE KEY-----` included. |
| `channels.push.apns needs ios, macos or both: the bundle id and environment of each app`, `channels.push.apns.<ios or macos>.bundleId is required`, `channels.push.apns.<ios or macos>.environment must be 'sandbox' or 'production'` | APNs’ iOS and macOS apps. |
| `channels.push.fcm.serviceAccount must be the contents of the service account JSON file`, `channels.push.fcm.serviceAccount has no <field>: use the JSON key file as downloaded`, `channels.push.fcm.serviceAccount has a private_key that is not a PEM key` | FCM’s service account: the whole JSON key file, as the Firebase console downloads it. |
| `channels.push.wns.<field> is required` | WNS’s tenant id, client id and client secret, from the Entra app registration the Windows app creates its channel with. |

**The Channels page asks again for credentials it had saved.** `CHASKI_SECRET` changed, or this
environment has another one: put the earlier value back, or save the credentials again under the
new one.

## Migrations

`` Chaski: the database is missing migrations <files>. Apply them with `wrangler d1 migrations apply CHASKI_DB --remote`. ``

- Run the command from the Chaski project. The message always names `--remote`; under
  `wrangler dev` the local database is the one missing them, so apply with `--local`. Another
  environment adds `--env <name>`. `--remote` acts on the user’s account: ask first.
- A new `database_id` means a new, empty local database; apply again.
- After a Chaski upgrade, new files arrive in `node_modules/chaskijs/migrations`; apply again
  before deploying.
- `wrangler d1 migrations apply` reports nothing to apply while Chaski still complains: the
  binding’s `migrations_dir` doesn’t reach `chaskijs/migrations` from `wrangler.jsonc` (a workspace
  hoisted the package to a parent `node_modules`), or it sets `migrations_table`. Chaski reads
  Wrangler’s default table, so leave `migrations_table` unset.

## Local development

- **The app’s startup log lists `CHASKI` as `[not connected]`, and its calls to Chaski fail.**
  Chaski’s `wrangler dev` isn’t running, or the binding’s `service` isn’t the Chaski Worker’s
  `name`. Start Chaski in its project; Wrangler connects the two by name once both run.
- **The user routes answer 502 `Chaski did not answer`.** The app couldn’t reach Chaski over the
  binding, and its log carries why: locally, the cause above; deployed, that environment’s Chaski
  isn’t deployed, or the app’s `env` block binds another name.
- **`isChaskiError()` is `false` for an error Chaski threw.** Between two local `wrangler dev`
  sessions a `ChaskiError` arrives as a plain `Error` whose message starts with `ChaskiError:`,
  with no `code`. Deployed Workers keep its `name` and `code` when both use a
  `compatibility_date` on or after `2026-04-21`. Keep the app’s code on `isChaskiError()` and
  `error.code`; to run an error branch, use a deployed environment, or a test that stands in for
  the binding (https://chaski.sh/docs/local-development#test-your-app).
- **Both dev servers want port 8787.** Start the app on another, such as
  `npx wrangler dev --port 8788`, and match `CHASKI_PUBLIC_URL` in Chaski’s `.dev.vars` to it.
- **A change to `.dev.vars` or `wrangler.jsonc` shows no effect.** Restart that dev server.
- **Schedules don’t fire after a restart.** Under `wrangler dev`, a schedule made before the dev
  server restarted stays `pending` past its time, and the dashboard marks it overdue. Its Workflow
  instance is still listed as running, but the local Workflows engine doesn’t wake an instance
  that was asleep when the server stopped; schedules made after the restart fire on time, and
  deployed Workflows aren’t affected. Wake one of two ways:
  - Call `env.CHASKI.schedule()` again with the same `idempotencyKey` and `scheduledAt`: it
    restarts the instance.
  - Restart the instance, whose id is the schedule’s (`scheduledId` from `schedule()`, `id` from
    `schedules().list()`): from the local explorer at `/cdn-cgi/local/explorer` of the Chaski
    session, or `npx wrangler workflows instances restart <workflow name> <schedule id> --local`
    in the Chaski project.

## Build and deploy

| Wrangler says | Fix |
| --- | --- |
| `Your Worker depends on the following Durable Objects, which are not exported in your entrypoint file: ChaskiFeed.`, or the same for the Workflow `ChaskiScheduler` | The Chaski project’s main module re-exports every class: `export { ChaskiEntrypoint, ChaskiEvents, ChaskiFeed, ChaskiScheduler, default } from 'chaskijs/worker';`. |
| An error about a Durable Object migration tag | Durable Object `migrations` entries already deployed stay as they are; a class bound later gets a new entry after them, with a tag of its own. |
| The app’s deploy refuses its `CHASKI` service binding | The Worker it names doesn’t exist in the account: deploy Chaski first, and check `service` (`chaski-staging` for the app’s `staging`). |
| A build error that `hono/route` can’t be resolved | `hono` is older than 4.8, the first version with that module. |

`npx wrangler deploy --dry-run --outdir "${TMPDIR:-/tmp}/chaski-dry-run"` catches the first two
without deploying. Errors from Chaski that reach the deployed app without their `code` mean one of
the two Workers has a `compatibility_date` before `2026-04-21`.

## Cloudflare Access

- **The dashboard answers “Chaski needs Cloudflare Access”**, and its API answers 403
  `turn on Cloudflare Access for this Worker`. The request reached the Worker without an Access
  identity, so Access doesn’t cover that URL. The user turns it on: the Chaski Worker, **Settings**
  › **Domains & Routes**, **Enable Cloudflare Access** on its workers.dev URL; a custom domain needs
  an Access application of its own, in Zero Trust. Locally, the Chaski project’s `wrangler.jsonc`
  lacks `access.dev`, or the dev server started before it was added.
- **The dashboard opens but never goes Live, with `CHASKI_EVENTS` bound.** Access was turned on
  from the Worker’s own **Access** tab, which refuses WebSocket upgrades. The user turns it off
  there and protects the hostname instead, as above.
- **The wrong people get in, or the right ones don’t.** The Access application’s policy decides,
  and everyone it admits can do everything in the dashboard. The user changes it under
  **Zero Trust** › **Access** › **Applications**.

## User routes

- **401 `not signed in`.** `identify` returned `null`, an empty id or one over 256 characters: the
  session middleware is registered after the `.route()` call or on another path, or the session
  didn’t come along (a frontend on another origin needs `credentials: 'include'`; see
  [browser-clients.md](browser-clients.md)).
- **403 `cross-origin request refused`.** A write or a socket upgrade came from an origin other
  than the request’s own or one in the mount’s `allowedOrigins`.
- **403 `this contact may not register devices`.** The mount’s `allowPush` returned `false`.
- **The browser blocks the responses from another origin.** `userRoutes()` adds no CORS headers;
  register Hono’s `cors()` with `credentials: true` for the mount’s path, before the mount
  ([browser-clients.md](browser-clients.md)).
- **A path answers the app’s own 404.** The mount doesn’t serve it: its group is missing from that
  mount’s `groups`, or the path is outside the mount.
- **The open rate stays at 0.** Emails carry the pixel only with `CHASKI_PUBLIC_URL` set in that
  environment. An email’s HTML (locally, from the explorer in [setup.md](setup.md), step 6) holds
  an image at `<CHASKI_PUBLIC_URL>/t/o/<delivery id>`, and that URL must reach the app’s mount.

## Sends and deliveries

| The send throws | Fix |
| --- | --- |
| `unknown notification type '<type>': register a template for it before sending` | Add the type to the template file and load it ([sending.md](sending.md)). |
| `channels not configured: <channels>` | The send’s `channels` names a channel without settings on **Channels** in this environment. |
| `scheduledAt must be ISO 8601 with an explicit offset (Z or ±hh:mm)` | Add the offset: `2026-11-01T09:00:00-05:00` or `…Z`. |
| `scheduledAt is in the past` | The time passed more than five minutes ago. |
| `an inline send delivers one email: it needs transactional: true and channels: ['email']` | Add both, or drop `inline`. |
| `the inline email would be skipped: <reason>` | The send recorded nothing; `missing_email` means the `recipient` has no `email`, `no_template` that the template has no enabled email content. |
| `channel_paused`: `the email channel is paused: delivery <id> is held until someone sends or discards it in the dashboard` | Someone paused email under **Channels**. The email waits under **Deliveries**, **Held**; resuming the channel and sending it, or the same send with its `idempotencyKey` once email runs again, lets it go out. |
| `delivery_failed`: `the email didn't go out: <provider error> (<code>, delivery <id>)` | An inline send the provider refused or couldn’t take; the delivery is `failed` in the dashboard with the same error. `sender_not_verified` and `sender_domain_not_available` are the setup’s to fix (the sender address on **Channels** must be on the domain onboarded to Email Service), `recipient_suppressed` the address’s. |

A delivery skipped at send time carries its reason:

| `reason` | Means |
| --- | --- |
| `channel_not_configured` | The channel has no settings on **Channels**, such as a scheduled send firing after they were removed. |
| `muted_by_preferences` | The contact turned the channel off or muted the type. `transactional: true` sends anyway, for the flows that must arrive. |
| `missing_email` | The send’s `recipient` has no `email`. |
| `no_device_tokens` | The contact has no registered browser or device: push was never enabled for that `recipient.id`. |
| `no_template` | The template has no enabled content for that channel. Expected when a type uses fewer channels than are on. |

A send whose `outcome` is `suppressed` was skipped everywhere by preferences; `undeliverable`
was skipped everywhere for one of the other reasons.

A push delivery that failed with `no_device_tokens` and `every device of the recipient was
dropped: APNs refused …` lost its devices to APNs, and Chaski logged each refusal to Workers Logs
as `device refused`:

| APNs said | Fix |
| --- | --- |
| `BadDeviceToken` in `production` | The token comes from a development build: register it with `environment: 'sandbox'`, or set the app’s environment to `sandbox` in the APNs settings of an environment only development builds use. |
| `BadDeviceToken` in `sandbox` | The token comes from a release build: drop the device’s `environment`, or set the app’s to `production`. |
| `DeviceTokenNotForTopic` | The token belongs to another app: check the app’s bundle id in the APNs settings, and that a Mac app registers as `macos` and an iPhone app as `ios`. |

The device comes back the next time the app registers its token, once the settings or the
registration are right.

**Deliveries show `held`.** Their channel is paused under **Channels**, the dashboard’s emergency
brake, and `ready()` lists it under `paused`. They wait until someone resumes the channel and
sends them, or discards them.

**Android deliveries retry with `FCM answered 403 (SENDER_ID_MISMATCH)` or `(PERMISSION_DENIED)`.**
The service account in the FCM settings belongs to another Firebase project than the one the app
registers its tokens with, or it may not send. Save a key of the app’s project; Chaski keeps the
devices until then.

**Deliveries stay `pending`.** Nothing consumes the queue. The Chaski project’s `wrangler.jsonc`
needs a `queues.consumers` entry for the same queue as the `CHASKI_QUEUE` producer, in every
environment, and its main module re-exports `default` from `chaskijs/worker`, which holds the
consumer. The queue is Chaski’s alone.

**Deliveries `failed` or `dead`.** **Deliveries** in the dashboard shows each attempt’s error. A
template Liquid can’t render or a misconfigured channel fails at once; a provider error retries
with backoff, then the delivery is `dead`. Fix the cause, then replay it from the dashboard. Keep
`max_retries: 5` on the queue consumer: with fewer, a delivery the queue gave up on stays
`pending`.

`attachment_missing` means a file under `att/` in the attachments bucket was gone when the
delivery read it: an R2 lifecycle rule deleted it before the schedule fired or the replay sent.
Lengthen the rule, then send again.

**Nothing arrives, yet deliveries show `sent`.** Under `wrangler dev`, email never leaves the
machine: each one lands under the Chaski project’s `.wrangler/tmp/email/`, and the log prints
where. Deployed, `sent` means Email Service accepted it: look in the recipient’s spam folder.

**Web push stopped reaching browsers after a key change.** A subscription belongs to the VAPID key
it was made with. Put the earlier pair back on **Channels**, or have users turn push on again.

## Dashboard

- **The header never says Live.** With `CHASKI_EVENTS` unbound, the dashboard opens no socket. It
  still works: it refreshes when its tab comes back into focus or reloads. Bind `CHASKI_EVENTS` for
  live updates; when it is bound, see “Cloudflare Access” above.

## Content-Security-Policy

- **The frontend’s feed doesn’t update live.** Its `connect-src` must allow the user routes’
  origin and its `wss://` counterpart when they’re on another origin. The client falls back to
  checking once a minute, so the feed still updates, late.
- **The service worker doesn’t register.** Its script must pass `worker-src`, which falls back to
  `child-src`, then `script-src`, then `default-src`.
- **The dashboard loads unstyled, or the email preview stays blank.** The Chaski Worker sends a
  policy of its own on each load, with a per-load nonce (`style-src 'self' 'nonce-…'`), and the
  preview document allows framing by the dashboard (`frame-ancestors 'self'`). Something in front
  of the Worker rewrote those headers, such as a Transform Rule on a custom domain’s zone that adds
  a policy or `X-Frame-Options: DENY`. Compare the headers in the browser’s developer tools with
  `curl -sI http://localhost:8787/` against the local Chaski, and take the dashboard’s hostname
  out of the rule.
