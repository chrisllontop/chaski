---
name: chaski
description: Chaski, email, web push, APNs, FCM, WNS and in-app notifications that run as a Cloudflare Worker of their own next to an app, which calls it over a service binding (npm package `chaskijs`). Use to set up a Chaski Worker and connect an app and its frontend to it, to audit the notifications a codebase sends and plan moving them onto Chaski, to write code that sends or schedules through it, or to fix a Chaski setup that fails (config errors, migrations, bindings, Cloudflare Access, CSP).
license: MIT
---

# Chaski

Chaski is a Cloudflare Worker of its own, one per environment of an app, on resources of its own:
a D1 database, a queue, Durable Objects and a Workflow. It sends email through Cloudflare Email
Service, web push, push to iOS and macOS through APNs, to Android through FCM and to Windows
through WNS, and keeps an in-app feed per user, with templates, preferences, scheduled sends,
retries and a dashboard. Docs: https://chaski.sh/docs.

Three pieces, each with its own home:

- **The Chaski project**: three files (`package.json`, `wrangler.jsonc`, a one-line
  `src/index.ts`) in a folder of the app’s repository or a repository of its own. Its Worker’s URL
  serves the dashboard, behind Cloudflare Access.
- **The app**: any Worker of the same Cloudflare account. It binds `CHASKI` to the Chaski Worker’s
  `ChaskiEntrypoint` and calls `env.CHASKI.send()`.
- **The user routes**: what the app mounts with `userRoutes()` from `chaskijs`, so its frontend
  reaches the signed-in user’s feed, devices and preferences. The app says who is signed in, and
  forwards each request to Chaski for that contact.

## Pick the reference

Read the one that matches the task, and only that one until it sends you to another.

| The user wants to | Read |
| --- | --- |
| Set up Chaski next to an app, add an environment or upgrade it | [references/setup.md](references/setup.md) |
| Show the feed, enable push or edit preferences in their frontend or a native app | [references/browser-clients.md](references/browser-clients.md) |
| Find the notifications their code sends and plan moving them onto Chaski | [references/audit.md](references/audit.md), which hands over to [references/plan.md](references/plan.md) |
| Send, schedule, write templates or set preferences in code | [references/sending.md](references/sending.md) |
| Fix a Chaski error or a part that doesn’t work | [references/troubleshooting.md](references/troubleshooting.md) |

When you read this file from https://chaski.sh/skill/SKILL.md rather than from disk, its links
resolve on chaski.sh too. Only the audit’s finder has to be on disk to run:
[references/audit.md](references/audit.md) says how to download it.

## What every task needs

- **Fit.** The app has to be a Cloudflare Worker of the account Chaski runs in: a service binding
  is the only way in, and Chaski has no HTTP API for callers anywhere else (a Node server, Vercel,
  Lambda). `userRoutes()` is a Hono 4.8+ app. Chaski’s channels are email, web push, iOS and macOS
  push, Android push, Windows push and in-app: SMS, WhatsApp, chat apps and Expo push tokens stay on
  the provider the project uses today.
- **Where each setting lives.**
  - The Chaski project’s `wrangler.jsonc`: the bindings, under fixed names; the vars
    `CHASKI_ENVIRONMENT` (the name the dashboard shows) and `CHASKI_PUBLIC_URL` (the absolute URL of
    the app’s `userRoutes()` mount, which serves the email open pixel; without it, emails carry
    none); `access.dev`, the identity `wrangler dev` signs in to the local dashboard.
  - The secret `CHASKI_SECRET`: encrypts the channel credentials saved in the dashboard. Set it once
    per environment and keep it: another value leaves those credentials unreadable.
  - The dashboard’s **Channels** page, per environment: each channel’s settings (sender address, push
    keys and credentials) and the types **Muted by default**. A channel is on once its settings are saved
    and off when they’re removed; a pause, also there, holds its deliveries instead.
  - The app’s Wrangler config: only the `CHASKI` service binding.
- **Bindings decide features.** Only `CHASKI_DB` (D1) and `CHASKI_QUEUE` (producer and consumer,
  `max_retries: 5`) are required. The email channel needs `CHASKI_EMAIL` (`send_email`), the in-app
  channel `CHASKI_FEED` (`ChaskiFeed`), `schedule()` needs `CHASKI_SCHEDULER` (`ChaskiScheduler`),
  attachments need `CHASKI_ATTACHMENTS` (R2), and live dashboard updates need `CHASKI_EVENTS`
  (`ChaskiEvents`). Push needs no binding.
- **Groups are methods.** A service binding exposes methods only, so the API’s groups are calls:
  `env.CHASKI.feed().unreadCount(id)`, `env.CHASKI.schedules().cancel(query)`, and likewise
  `push()`, `preferences()` and `templates()`.
- **Words.** A **notification** has a **type** (`payment_received`), and each type has a
  **template** with content per **channel** (`email`, `in_app`, `push`). One notification going out
  on one channel is a **delivery**. The person receiving it is the **contact** (`recipient` in
  code), their choices are **preferences**, and the in-app list is their **feed**.
- **The types are the truth.** Once `chaskijs` is installed, its declarations answer any question
  about a field: `node_modules/chaskijs/dist/contract/contract.d.ts` (requests and results),
  `dist/contract/api.d.ts` (the API) and `dist/app/user-routes.d.ts` (the options of
  `userRoutes()`). When they and this skill disagree, follow the declarations. Before it’s
  installed, as in an audit, use https://chaski.sh/docs, and list what neither settles as something
  to check after install.
- **Local first.** `wrangler dev` runs every binding on the machine: Chaski in one session, the app
  in another, connected by name. Every email lands on disk, under the Chaski project’s
  `.wrangler/tmp/email/`, and push only reaches browsers subscribed against the local database.
  Every new setup and every newly moved type runs there before anything real goes out.
- **The user’s Cloudflare account is theirs.** Creating resources, applying migrations with
  `--remote`, setting secrets and deploying, Chaski or the app, act on their account: ask before
  each one. Turning on Cloudflare Access and saving the production channel settings are theirs to
  do, in the Cloudflare dashboard and in Chaski’s: hand them the steps.
