<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-white.svg">
    <img alt="Chaski" src="brand/logo-black.svg" height="40">
  </picture>
</h1>

Notification infrastructure that runs as its own Cloudflare Worker, dashboard included.

[![License: MIT](https://img.shields.io/badge/license-MIT-404040?style=flat-square)](LICENSE)
![Runs on Cloudflare Workers](https://img.shields.io/badge/runs_on-Cloudflare_Workers-404040?style=flat-square)
[![npm](https://img.shields.io/npm/v/chaskijs?color=404040&style=flat-square)](https://www.npmjs.com/package/chaskijs)

## What it does

Chaski is a Worker of its own. You deploy it to your Cloudflare account next to your app, one per
environment, and your app sends through it over a service binding. It runs on your own Cloudflare
resources, so your data stays in your account.

- **Email, push, and in-app.** Email through Cloudflare Email Service, web push, push to iOS and
  macOS through APNs, to Android through FCM and to Windows through WNS, and an in-app feed that
  updates live.
- **Templates** for the content of every notification, written in Liquid and edited in the
  dashboard with a live preview.
- **Preferences** that let each contact mute the notifications they don’t want.
- **Scheduling** for notifications that go out later, with cancellation.
- **Retries** for deliveries that fail along the way, and a replay for the ones that run out.
- **A dashboard** at the Worker’s own URL, behind Cloudflare Access, where your team sets up the
  channels and follows every delivery.

## Install

### Requirements

- A Cloudflare account, with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/)
  to sign your team in to the dashboard.
- For email, the Workers Paid plan and a domain onboarded to
  [Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/).
- For iOS and macOS push, an APNs key from your Apple developer account. For Android, a service
  account key from your Firebase project. For Windows, a Microsoft Entra app registration with a
  client secret. Web push needs nothing: Chaski makes its own key pair.

### 1. Create the project

```sh
npx chaskijs@next init
```

`@next` picks Chaski 0.1, in pre-release until it ships as `latest`. The command asks where the
project lives (a folder of your app’s repository, such as `chaski/`, or a new repository), the
Worker’s name, which names its resources, and whether to send email and attachments. Every answer
has a flag (`--folder`, `--repo`, `--name`, `--no-email`, `--attachments`, `--public-url`), for
scripts and agents.

It writes the project, installs it and creates the local database. Besides `.dev.vars`, the
local settings `wrangler dev` reads, and a `.gitignore`, the project holds three files:

- `package.json`, with `chaskijs`, `hono` and `wrangler`.
- `src/index.ts`, the only code the project holds:

  ```ts
  export { ChaskiEntrypoint, ChaskiEvents, ChaskiFeed, ChaskiScheduler, default } from 'chaskijs/worker';
  ```

- `wrangler.jsonc`, with the bindings Chaski reads by name. Only `CHASKI_DB` and `CHASKI_QUEUE`
  are required; the rest turn on a feature each:

  | Binding | Needed for |
  | --- | --- |
  | `CHASKI_FEED` | The in-app channel |
  | `CHASKI_EVENTS` | Live updates in the dashboard |
  | `CHASKI_SCHEDULER` | `schedule()` |
  | `CHASKI_EMAIL` | The email channel |
  | `CHASKI_ATTACHMENTS` | Email attachments |

[Install](https://chaski.sh/docs/install#read-what-it-wrote) shows the whole `wrangler.jsonc`.

### 2. Deploy

In the project, signed in with `npx wrangler login`:

```sh
npx chaskijs deploy
```

It lists what the Worker is missing in your Cloudflare account and asks before it acts: it creates
the database, the queues and, with attachments, the R2 bucket, applies Chaski’s migrations, and
deploys. The first deploy uploads a random `CHASKI_SECRET` with the Worker
(`wrangler deploy --secrets-file`), so it never runs without one; the secret encrypts the channel
credentials you save in the dashboard. Set it by hand on a Worker that already runs, with
`wrangler secret put CHASKI_SECRET` after a deploy: until the Worker exists, `secret put` creates
an empty one under its name. Run `chaskijs deploy` again after every upgrade: it creates only
what’s missing and migrates before it deploys.

### 3. Turn on Cloudflare Access

The Worker’s URL serves the dashboard, and opens only for people Cloudflare Access signs in. In the
Cloudflare dashboard, open the `chaski` Worker, go to **Settings** › **Domains & Routes** and
select **Enable Cloudflare Access** on its workers.dev URL, then choose who gets in in the Access
application it creates. Protect the hostname this way rather than from the Worker’s own **Access**
tab, which refuses the WebSocket the dashboard’s live updates use.

### 4. Set up the channels

Open the dashboard and go to **Channels**. Every channel starts off and turns on once you save its
settings there: the sender address for email, the in-app feed, and a key pair for web push or the
credentials of APNs, FCM and WNS.

New versions come through the package: `npx chaskijs upgrade` installs the latest and updates the
project to it, then `npx chaskijs deploy` ships it. `npx chaskijs env add staging` adds an
environment with resources of its own; see [Environments](https://chaski.sh/docs/environments).

## Connect your app

Your app binds to Chaski with a service binding, and needs `chaskijs` only for its types and for
`userRoutes()`:

```sh
npm install chaskijs hono
```

```jsonc
// your app's wrangler.jsonc
{
  "services": [{ "binding": "CHASKI", "service": "chaski", "entrypoint": "ChaskiEntrypoint" }]
}
```

Your frontend reads the signed-in user’s feed, registers their devices and saves their preferences
through routes your app mounts. Your app says who is signed in, and forwards each request to Chaski
for that contact:

```ts
import { Hono } from 'hono';
import { type ChaskiEntrypoint, userRoutes } from 'chaskijs';
import { currentUserId } from './session'; // your app’s own sign-in

type Env = { CHASKI: Service<ChaskiEntrypoint> };

const app = new Hono<{ Bindings: Env }>();

app.route(
  '/me/notifications',
  userRoutes({
    chaski: (c) => c.env.CHASKI,
    // The signed-in user's id; null answers 401, and a Response is returned as is.
    identify: (c) => currentUserId(c),
  }),
);
```

Point `CHASKI_PUBLIC_URL` at the absolute URL of that mount. Each environment of your app binds to
the Chaski of that environment; [Environments](https://chaski.sh/docs/environments) adds staging
to the same Chaski project.

## Send notifications

Every notification has a type, and each type needs a template before you send it. Create one in the
dashboard under **Templates**: give it a type such as `payment_received`, then write its content
for each channel. Templates are [Liquid](https://liquidjs.com), and they see the payload you send
plus `recipient`:

```liquid
Thanks, {{ recipient.name }}. We received your payment of {{ amount }}.
```

Templates can also live in your repository as a
[template file](https://chaski.sh/docs/templates#keep-templates-in-a-file), loaded over the binding
with `await env.CHASKI.templates().import(file)`, which creates or updates them by type. Before
`wrangler dev` starts, or from a deploy job, `npx chaskijs templates sql chaski-templates.json`
turns the file into SQL for `wrangler d1 execute --file` in the Chaski project.

Then send from anywhere in your app:

```ts
const result = await env.CHASKI.send({
  type: 'payment_received',
  recipient: { id: user.id, email: user.email, name: user.name },
  payload: { amount: '$15.00' },
  // Optional: a retried request with the same key sends only once.
  idempotencyKey: `payment:${payment.id}`,
});
```

Chaski delivers through every channel the template has turned on, except the ones the contact
muted. `channels: ['email']` narrows that, and `transactional: true` sends regardless of the
contact’s preferences, for receipts and password resets. Each delivery goes through Chaski’s queue, and
the dashboard shows it as it moves.

When someone waits on screen for the email, such as a password reset, add `inline: true`: Chaski
delivers it before `send()` returns, and throws a `ChaskiError` with the code `delivery_failed`
when the provider doesn’t take it, so the request that asked for it can say so.

```ts
await env.CHASKI.send({
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
await env.CHASKI.schedule({
  type: 'invoice_due',
  recipient: { id: user.id, email: user.email },
  payload: { invoice: 'INV-1042' },
  scheduledAt: '2026-11-01T09:00:00-05:00',
  // Scheduling the same key again moves the pending send instead of adding one.
  idempotencyKey: 'invoice-due:INV-1042',
});

await env.CHASKI.schedules().cancel({ idempotencyKey: 'invoice-due:INV-1042' });
```

A service binding exposes methods only, so the groups are methods: a contact’s feed (`feed()`),
devices (`push()`) and preferences (`preferences()`), and the `schedules()` and `templates()`. A
call like `env.CHASKI.feed().list(query)` still takes a single round trip. Errors arrive with their
`name` (`ChaskiError`) and `code`, such as `validation`, when both Workers use a compatibility date
on or after `2026-04-21`; check them with `isChaskiError()` from `chaskijs`.

## In the browser

`chaskijs/client` talks to the routes your app mounts with `userRoutes()`:

```ts
import { createChaskiClient } from 'chaskijs/client';

const client = createChaskiClient({ baseUrl: '/me/notifications' });

const { items } = await client.feed.list();
const stop = client.feed.subscribe((event) => {
  // a new item arrives whole; without an event, the feed may have changed: list it again
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

An Electron app on macOS gets its push through APNs instead. Its main process asks for the token,
and the client registers it for the signed-in user:

```ts
import { pushNotifications } from 'electron';

const deviceToken = await pushNotifications.registerForAPNSNotifications();
await client.push.registerDevice({ platform: 'macos', deviceToken });
```

On Windows, the app registers the channel URI the Windows App SDK gives it, again on every launch,
since WNS channels expire after 30 days:
`client.push.registerDevice({ platform: 'windows', deviceToken: channelUri })`.

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

`wrangler dev` runs everything on your machine, and `chaskijs init` already created the local
database and wrote a local secret into `.dev.vars`. In the Chaski project:

```sh
npx wrangler dev
```

The dashboard is at `localhost:8787`, signed in as the identity under `access.dev`. Start your app
with `wrangler dev --port 8788` in a second terminal: its `CHASKI` binding finds the local Chaski by
name. `wrangler dev` keeps every email Chaski sends on disk, under `.wrangler/tmp/email/`, instead of
delivering it. [Local development](https://chaski.sh/docs/local-development) has the details.

## Use Chaski with a coding agent

Paste this prompt into your coding agent, in the project that holds your app’s Worker:

```text
Set up Chaski for this app: notifications that run as a Worker of their own, next to it. Follow https://chaski.sh/skill/SKILL.md step by step, and ask me before anything that touches my Cloudflare account.
```

The agent reads Chaski’s [agent skill](skills/chaski/SKILL.md) from chaski.sh, creates the Chaski
project next to your app and connects your app to it, asking before anything that acts on your
account. Any agent that can read a URL
works.

To keep the skill in your project instead, add it with the
[`skills` CLI](https://github.com/vercel-labs/skills), which installs it for Claude Code, Codex,
Cursor and the other agents that read skills:

```sh
npx skills add chrisllontop/chaski
```

Your agent then reads it from disk for any Chaski task: setting Chaski up next to your app and your
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
pnpm dev               # a sample Chaski Worker, with an app's user routes next to it
curl -X POST localhost:8787/dev/seed   # sample templates and sends
```

`pnpm dev` serves the dashboard at `localhost:8787`, and an app’s user routes at
`localhost:8787/app/notifications`. It doesn’t reload; run it again after you change the dashboard.

Before you open a pull request:

- Run `pnpm check` (typecheck, lint and tests) and `pnpm build`. CI runs both.
- Add tests for what you change. They run in workerd against the sample Worker, assert behavior
  rather than markup, and wait with fake timers or `vi.waitFor`, never with sleeps.
- Write commits in the imperative and sentence case, without prefixes: `Add a digest channel`.
- Describe the pull request with a Summary, the Evidence that it works, and its Merge Danger.

[`AGENTS.md`](AGENTS.md) maps the code, and the guides in [`.agents`](.agents) hold the conventions
for code, copy, the API and the database.

## Logo

The mark is a handoff: a single stroke runs along one lane, steps across and carries on in the next.
[`brand/`](brand) holds the mark and the full logo, in black and in white.

## License

Chaski is released under the [MIT License](LICENSE). Copyright © 2026 Christian Llontop.
