---
name: chaski
description: Chaski, email, web push, APNs, FCM and in-app notifications that run inside a Cloudflare Worker (npm package `chaskijs`). Use to set up Chaski in a Worker or its frontend, to audit the notifications a codebase sends and plan moving them onto Chaski, to write code that sends or schedules with it, or to fix a Chaski setup that fails (config errors, migrations, bindings, sign-in, CSP).
license: MIT
---

# Chaski

Chaski is a library, not a hosted service. A Cloudflare Worker, the **host**, mounts it on a route
of its Hono app, and Chaski runs on the host’s own D1 database, queue, Durable Objects and Workflow.
It sends email through Cloudflare Email Service, web push, push to iOS and macOS through APNs, to
Android through FCM and to Windows through WNS, and keeps an in-app feed per user, with templates, preferences, scheduled sends,
retries and a dashboard.
Docs: https://chaski.sh/docs.

## Pick the reference

Read the one that matches the task, and only that one until it sends you to another.

| The user wants to | Read |
| --- | --- |
| Add Chaski to a Worker | [references/setup.md](references/setup.md) |
| Show the feed, enable push or edit preferences in their frontend | [references/browser-clients.md](references/browser-clients.md) |
| Find the notifications their code sends and plan moving them onto Chaski | [references/audit.md](references/audit.md), which hands over to [references/plan.md](references/plan.md) |
| Send, schedule, write templates or set preferences in code | [references/sending.md](references/sending.md) |
| Fix a Chaski error or a part that doesn’t work | [references/troubleshooting.md](references/troubleshooting.md) |

When you read this file from https://chaski.sh/skill/SKILL.md rather than from disk, its links
resolve on chaski.sh too. Only the audit’s finder has to be on disk to run:
[references/audit.md](references/audit.md) says how to download it.

## What every task needs

- **Fit.** Chaski runs only inside a Cloudflare Worker, and its routes are Hono 4.8+ apps. Code
  that runs anywhere else (a Node server, Vercel, Lambda) can’t host it, and Chaski has no HTTP API
  for sending from outside Cloudflare. Its channels are email, web push, iOS and macOS push, Android
  push, Windows push and in-app: SMS, WhatsApp, chat apps and Expo push tokens stay on the provider the project uses
  today.
- **Bindings decide features.** Only the `db` (D1) and `queue` bindings are required. The email
  channel needs `email` (a `send_email` binding), the in-app channel needs `feed` (the `ChaskiFeed`
  Durable Object), `chaski.schedule()` needs `scheduler` (the `ChaskiScheduler` Workflow),
  attachments need `attachments` (R2), and live dashboard updates need `events` (the
  `ChaskiEvents` Durable Object).
- **Words.** A **notification** has a **type** (`payment_received`), and each type has a
  **template** with content per **channel** (`email`, `in_app`, `push`). One notification going out
  on one channel is a **delivery**. The person receiving it is the **contact** (`recipient` in
  code), their choices are **preferences**, and the in-app list is their **feed**.
- **The types are the truth.** Once `chaskijs` is installed, its declarations answer any question
  about an option or a field: `node_modules/chaskijs/dist/server/config.d.ts` (the config),
  `dist/contract/contract.d.ts` (requests and results) and `dist/contract/api.d.ts` (the API). When
  they and this skill disagree, follow the declarations. Before it’s installed, as in an audit,
  use https://chaski.sh/docs, and list what neither settles as something to check after install.
- **Local first.** Under `wrangler dev` every email lands on disk, under `.wrangler/tmp/email/`,
  instead of in an inbox, and push only reaches browsers subscribed against the local database.
  Every new setup and every newly moved type runs there before anything real goes out.
- **The user’s Cloudflare account is theirs.** Creating resources, applying migrations with
  `--remote`, setting secrets and deploying all act on production. Ask before each one; locally,
  `wrangler dev` needs none of them.
