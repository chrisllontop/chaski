<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-white.svg">
    <img alt="Chaski" src="brand/logo-black.svg" height="40">
  </picture>
</h1>

Embeddable notification infrastructure for Cloudflare Workers, dashboard included.

[![License: MIT](https://img.shields.io/badge/license-MIT-404040?style=flat-square)](LICENSE)
![Runs on Cloudflare Workers](https://img.shields.io/badge/runs_on-Cloudflare_Workers-404040?style=flat-square)
[![npm](https://img.shields.io/npm/v/chaskijs?color=404040&style=flat-square)](https://www.npmjs.com/package/chaskijs)

## What it does

Chaski lives inside your Worker. You mount it on a route of your app, and it runs on your own
Cloudflare resources. It deploys with your Worker, and your data stays in your account.

- **Email, push, and in-app.** Email through Cloudflare Email Service, web push, push to iOS through
  APNs, and an in-app feed that updates live.
- **Templates** for the content of every notification, written in Liquid and edited in the
  dashboard with a live preview.
- **Preferences** that let each contact mute the notifications they don’t want.
- **Scheduling** for notifications that go out later, with cancellation.
- **Retries** for deliveries that fail along the way, and a replay for the ones that run out.
- **A dashboard**, served from the same route, behind the sign-in you choose.

## Install

### Requirements

- A Worker built with [Hono](https://hono.dev) 4.8 or later. Chaski’s routes are Hono apps you
  mount on yours.
- For email, the Workers Paid plan and a domain onboarded to
  [Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/).
- For web push, a VAPID key pair. For iOS, an APNs key from your Apple developer account.

Chaski runs only on the bindings you declare. This guide declares all of them, and step 3 says which
ones you can leave out. Resource and binding names are yours to choose; only the class names are
fixed.

### 1. Add the package

```sh
npm install chaskijs hono
```

### 2. Create the resources

```sh
npx wrangler d1 create my-app-chaski
npx wrangler queues create my-app-deliveries
npx wrangler queues create my-app-deliveries-dlq
npx wrangler r2 bucket create my-app-attachments   # only for email attachments
```

The Durable Objects and the Workflow are created when you deploy.

### 3. Declare the bindings

In `wrangler.jsonc`:

```jsonc
{
  "name": "my-app",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-15",
  "vars": {
    // The absolute URL where you mount the dashboard (step 5).
    "CHASKI_PUBLIC_URL": "https://app.example.com/admin/notifications",
    "VAPID_PUBLIC_KEY": "<public key from step 6>"
  },
  "d1_databases": [
    {
      "binding": "CHASKI_DB",
      "database_name": "my-app-chaski",
      "database_id": "<id printed by wrangler d1 create>",
      // Chaski's tables come from the package.
      "migrations_dir": "node_modules/chaskijs/migrations"
    }
  ],
  "queues": {
    "producers": [{ "binding": "CHASKI_QUEUE", "queue": "my-app-deliveries" }],
    "consumers": [
      {
        "queue": "my-app-deliveries",
        "max_batch_size": 10,
        "max_batch_timeout": 1,
        // Must match Chaski's maxRetries, which defaults to 5.
        "max_retries": 5,
        "dead_letter_queue": "my-app-deliveries-dlq"
      }
    ]
  },
  "durable_objects": {
    "bindings": [
      { "name": "CHASKI_FEED", "class_name": "ChaskiFeed" },
      { "name": "CHASKI_EVENTS", "class_name": "ChaskiEvents" }
    ]
  },
  "migrations": [{ "tag": "chaski-v1", "new_sqlite_classes": ["ChaskiFeed", "ChaskiEvents"] }],
  "workflows": [
    { "name": "my-app-scheduler", "binding": "CHASKI_SCHEDULER", "class_name": "ChaskiScheduler" }
  ],
  "r2_buckets": [{ "binding": "CHASKI_ATTACHMENTS", "bucket_name": "my-app-attachments" }],
  "send_email": [{ "name": "CHASKI_EMAIL" }]
}
```

If your Worker already has Durable Object migrations, add Chaski’s after them with a tag of its own.
Give Chaski a database of its own, since a D1 binding takes its migrations from a single folder.

Only `db` and `queue` are required. Leave out what you don’t use, both here and in Chaski’s
config (step 5):

| `bindings` key | Needed for |
| --- | --- |
| `feed` (ChaskiFeed) | The in-app channel |
| `events` (ChaskiEvents) | Live updates in the dashboard |
| `scheduler` (ChaskiScheduler) | `chaski.schedule()` |
| `email` (`send_email`) | The email channel |
| `attachments` (R2) | Email attachments |

### 4. Create the tables

```sh
npx wrangler d1 migrations apply CHASKI_DB --remote
```

Run it again after every Chaski upgrade. Chaski checks that every migration it ships has been
applied, and refuses to run until they are, naming the missing ones.

### 5. Mount Chaski

In your main module, `src/index.ts`:

```ts
import { Hono } from 'hono';
import {
  type ChaskiEvents,
  type ChaskiFeed,
  cloudflareAccess,
  createChaski,
  type DeliveryMessage,
  type ScheduleParams,
  type SendEmailBinding,
} from 'chaskijs';
import { currentUserId } from './session'; // your app’s own sign-in

// The bindings find Chaski's classes through the main module's exports.
export { ChaskiEvents, ChaskiFeed, ChaskiScheduler } from 'chaskijs';

type Env = {
  CHASKI_PUBLIC_URL: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  CHASKI_DB: D1Database;
  CHASKI_QUEUE: Queue<DeliveryMessage>;
  CHASKI_FEED: DurableObjectNamespace<ChaskiFeed>;
  CHASKI_EVENTS: DurableObjectNamespace<ChaskiEvents>;
  CHASKI_SCHEDULER: Workflow<ScheduleParams>;
  CHASKI_EMAIL: SendEmailBinding;
  CHASKI_ATTACHMENTS: R2Bucket;
};

// Chaski reads this on every call, so secrets and vars come from the env of the moment.
export const chaski = createChaski((env: Env) => ({
  publicUrl: env.CHASKI_PUBLIC_URL,
  bindings: {
    db: env.CHASKI_DB,
    queue: env.CHASKI_QUEUE,
    feed: env.CHASKI_FEED,
    events: env.CHASKI_EVENTS,
    scheduler: env.CHASKI_SCHEDULER,
    email: env.CHASKI_EMAIL,
    attachments: env.CHASKI_ATTACHMENTS,
  },
  // A channel is on when it has an entry here.
  channels: {
    email: { from: 'notifications@example.com', fromName: 'My App' },
    in_app: {},
    push: {
      vapid: {
        subject: 'mailto:ops@example.com',
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
    },
  },
}));

const app = new Hono<{ Bindings: Env }>()
  // The dashboard and its API, for your team.
  .route(
    '/admin/notifications',
    chaski.routes({
      dashboard: {
        authorize: cloudflareAccess({
          teamDomain: 'example.cloudflareaccess.com',
          audience: '<Access application AUD tag>',
        }),
      },
    }),
  )
  // Feed, devices and preferences of the signed-in user, for your frontend.
  .route(
    '/me/notifications',
    chaski.userRoutes({
      // The signed-in user's id, or null to answer 401.
      identify: (c) => currentUserId(c),
    }),
  );

export default {
  fetch: app.fetch,
  queue: async (batch, env, ctx) => {
    // chaski.queue() returns false for a batch from any other queue.
    if (await chaski.queue(batch, env, ctx)) return;
    // batches from your other queues
  },
} satisfies ExportedHandler<Env>;
```

`publicUrl` must be the absolute URL of the dashboard’s mount: Chaski builds the email
open-tracking link from it, and accepts writes from its origin.

`authorize` decides who gets into the dashboard. It returns who is signed in (`{ id, name? }`),
`null` to answer 403, or a `Response` such as a redirect to your login page. Chaski ships two:

- `cloudflareAccess({ teamDomain, audience })` checks the token of a
  [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) application
  that protects the mount path.
- `basicAuth({ username, password })` asks the browser for one username and password; read them
  from secrets.

Admin actions in the dashboard are recorded under the `id` that `authorize` returns. Add
`canPauseChannels: (c, actor) => boolean` next to `authorize` for who may
[pause a channel](https://chaski.sh/docs/dashboard#pause-a-channel), the dashboard’s emergency
brake; without it nobody can.

`userRoutes` reads the contact from `identify` only, never from what the browser sends. If your frontend is
served from another origin, list it in `allowedOrigins`: Chaski refuses writes and live
connections from origins it doesn’t know. The browser also needs CORS on these routes, which your
app answers: register `cors({ origin, credentials: true })` from `hono/cors` on the mount path
before `userRoutes`, so it answers the preflight before `identify` runs.

### 6. Add the push keys

For web push, generate a VAPID key pair and keep the private key as a secret:

```sh
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PRIVATE_KEY
```

The public key goes in `VAPID_PUBLIC_KEY` (step 3). For iOS, add `apns` next to `vapid`:

```ts
push: {
  apns: {
    teamId: '<Apple team id>',
    keyId: '<APNs key id>',
    bundleId: 'com.example.app',
    environment: 'production', // 'sandbox' for development builds
    privateKey: env.APNS_PRIVATE_KEY, // the contents of the .p8 file
  },
},
```

```sh
npx wrangler secret put APNS_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
```

### 7. Deploy

```sh
npx wrangler deploy
```

Then open `https://app.example.com/admin/notifications`. The **Channels** page shows what Chaski
picked up from your config.

## Send notifications

Every notification has a type, and each type needs a template before you send it. Create one in the
dashboard under **Templates**: give it a type such as `payment_received`, then write its content
for each channel. Templates are [Liquid](https://liquidjs.com), and they see the payload you send
plus `recipient`:

```liquid
Thanks, {{ recipient.name }}. We received your payment of {{ amount }}.
```

Templates can also live in your repository as a
[template file](https://chaski.sh/docs/templates#keep-templates-in-a-file), loaded from your tests
or another Worker with `await chaski.templates.import(file)`, which creates or updates them by
type. Before `wrangler dev` starts, or from a deploy job, `npx chaskijs templates sql
chaski-templates.json` turns the file into SQL for `wrangler d1 execute --file`.

Then send from anywhere in your Worker:

```ts
const result = await chaski.send({
  type: 'payment_received',
  recipient: { id: user.id, email: user.email, name: user.name },
  payload: { amount: '$15.00' },
  // Optional: a retried request with the same key sends only once.
  idempotencyKey: `payment:${payment.id}`,
});
```

Chaski delivers through every channel the template has turned on, except the ones the contact
muted. `channels: ['email']` narrows that, and `transactional: true` sends regardless of the
contact’s preferences, for receipts and password resets. Each delivery goes through the queue, and
the dashboard shows it as it moves.

When someone waits on screen for the email, such as a password reset, add `inline: true`: Chaski
delivers it before `send()` returns, and throws a `ChaskiError` with the code `delivery_failed`
when the provider doesn’t take it, so the request that asked for it can say so.

```ts
await chaski.send({
  type: 'password_reset',
  recipient: { id: user.id, email: user.email },
  payload: { link },
  channels: ['email'],
  transactional: true,
  inline: true,
});
```

To send later, pass a time with its offset:

```ts
await chaski.schedule({
  type: 'invoice_due',
  recipient: { id: user.id, email: user.email },
  payload: { invoice: 'INV-1042' },
  scheduledAt: '2026-11-01T09:00:00-05:00',
  // Scheduling the same key again moves the pending send instead of adding one.
  idempotencyKey: 'invoice-due:INV-1042',
});

await chaski.schedules.cancel({ idempotencyKey: 'invoice-due:INV-1042' });
```

The same object answers for a contact’s feed (`chaski.feed`), devices (`chaski.push`) and
preferences (`chaski.preferences`) on the server, and for the templates (`chaski.templates`).

## Call Chaski from your other Workers

Chaski runs in the Worker that mounts it. Your other Workers in the same Cloudflare account reach it
over RPC, through a service binding. Export the entrypoint from the host’s main module, next to the
other classes:

```ts
export { ChaskiEntrypoint, ChaskiEvents, ChaskiFeed, ChaskiScheduler } from 'chaskijs';
```

Then bind to it from the other Worker’s `wrangler.jsonc`, with the host’s Worker name as `service`:

```jsonc
{
  "services": [{ "binding": "CHASKI", "service": "my-app", "entrypoint": "ChaskiEntrypoint" }]
}
```

```ts
import type { ChaskiEntrypoint } from 'chaskijs';

type Env = { CHASKI: Service<ChaskiEntrypoint> };

export const sendPaymentReceived = async (env: Env, user: { id: string; email: string }) => {
  await env.CHASKI.send({
    type: 'payment_received',
    recipient: { id: user.id, email: user.email },
    payload: { amount: '$15.00' },
  });
  return env.CHASKI.feed().unreadCount(user.id);
};
```

A service binding exposes methods only, so over RPC the groups are methods: `feed()`, `push()`,
`preferences()`, `schedules()` and `templates()`. A call like `env.CHASKI.feed().list(query)` still
takes a single round trip. Errors arrive with their `name` (`ChaskiError`) and `code`, such as
`validation`, when both Workers use a compatibility date on or after `2026-04-21`.

## In the browser

`chaskijs/client` talks to the routes you mounted with `chaski.userRoutes()`:

```ts
import { createChaskiClient } from 'chaskijs/client';

const client = createChaskiClient({ baseUrl: '/me/notifications' });

const { items } = await client.feed.list();
const stop = client.feed.subscribe(() => {
  // a new notification arrived: list the feed again
});

await client.push.enable(); // asks for permission and registers this browser
```

Web push needs a service worker. Bundle one that hands pushes to Chaski and serve it at `/sw.js`,
or pass its path to the client as `push.serviceWorkerPath`:

```ts
import { handlePushEvents } from 'chaskijs/sw';

declare const self: ServiceWorkerGlobalScope;

handlePushEvents(self, { icon: '/icon-192.png' });
```

With React, `chaskijs/react` wraps the client in hooks:

```tsx
import { ChaskiProvider, useFeed, useUnreadCount } from 'chaskijs/react';

const Bell = () => {
  const { unread } = useUnreadCount();
  const { items, markRead } = useFeed({ limit: 20 });
  // …
};

<ChaskiProvider client={client}>
  <Bell />
</ChaskiProvider>;
```

`usePush()` and `usePreferences()` cover the rest: a push toggle and a preferences screen built
from the types each topic groups.

## Develop locally

`wrangler dev` runs everything on your machine. Apply the migrations to the local database first:

```sh
npx wrangler d1 migrations apply CHASKI_DB --local
```

`.dev.vars` overrides `vars` under `wrangler dev`: point `CHASKI_PUBLIC_URL` at the local mount
there, and keep the private keys from step 6 next to it.

```sh
CHASKI_PUBLIC_URL=http://localhost:8787/admin/notifications
VAPID_PRIVATE_KEY=<private key from step 6>
```

`wrangler dev` keeps every email Chaski sends on disk, under `.wrangler/tmp/email/`, instead of
delivering it.

Cloudflare Access doesn’t sit in front of `wrangler dev`, so `cloudflareAccess()` answers 403 to
the local dashboard. Pass `environment: env.ENVIRONMENT` in the config and set `ENVIRONMENT=local`
in `.dev.vars`, never in a deployed environment’s `vars`: the local dashboard then opens without
`authorize`, and its header shows the environment.
[Local development](https://chaski.sh/docs/local-development) has the details, and where to read
the emails `wrangler dev` sends.

## Use Chaski with a coding agent

Paste this prompt into your coding agent, in the project that holds your Worker:

```text
Set up Chaski, notifications for Cloudflare Workers, in this project. Follow https://chaski.sh/skill/SKILL.md step by step, and ask me before anything that touches my Cloudflare account.
```

The agent reads Chaski’s [agent skill](skills/chaski/SKILL.md) from chaski.sh and sets Chaski up
in your Worker, asking before anything that acts on your account. Any agent that can read a URL
works.

To keep the skill in your project instead, add it with the
[`skills` CLI](https://github.com/vercel-labs/skills), which installs it for Claude Code, Codex,
Cursor and the other agents that read skills:

```sh
npx skills add chrisllontop/chaski
```

Your agent then reads it from disk for any Chaski task: setting Chaski up in your Worker and your
frontend, auditing the notifications your code already sends and planning the move onto Chaski,
and working through a setup that fails.

## Contributing

Issues and pull requests are welcome. Open an
[issue](https://github.com/chrisllontop/chaski/issues) first for anything larger than a fix, so we
can agree on the approach.

You need Node 24 and pnpm 12.

```sh
pnpm i
pnpm build:dashboard   # once, on a fresh clone
pnpm wrangler d1 migrations apply CHASKI_DB --local -c test/fixture/wrangler.jsonc
pnpm dev               # a sample Worker with Chaski mounted, in the local environment
curl -X POST localhost:8787/dev/seed   # sample templates and sends
```

`pnpm dev` serves the dashboard at `localhost:8787/chaski`. It doesn’t reload; run it again after
you change the dashboard.

Before you open a pull request:

- Run `pnpm check` (typecheck, lint and tests) and `pnpm build`. CI runs both.
- Add tests for what you change. They run in workerd against the sample Worker, assert behavior
  rather than markup, and wait with fake timers or `vi.waitFor`, never with sleeps.
- Write commits in the imperative and sentence case, without prefixes: `Add a digest channel`.
- Describe the pull request with a Summary, the Evidence that it works, and its Merge Danger.

[`AGENTS.md`](AGENTS.md) maps the code, and [`.cursor/rules`](.cursor/rules) holds the conventions
for code, copy, the API and the database.

## Logo

The mark is a handoff: a single stroke runs along one lane, steps across and carries on in the next.
[`brand/`](brand) holds the mark and the full logo, in black and in white.

## License

Chaski is released under the [MIT License](LICENSE). Copyright © 2026 Christian Llontop.
