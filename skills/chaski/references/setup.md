# Set up Chaski next to an app

Work through the steps in order. Each ends on a **Done when** line; start the next step only once
it holds. Steps 1 to 6 run on the user’s machine and touch nothing in their Cloudflare account;
step 7 does, with their yes. The same guide for people: https://chaski.sh/docs/install and
https://chaski.sh/docs/connect.

The binding names (`CHASKI_DB`…), the class names and `ChaskiEntrypoint` are fixed. The rest are
names to choose: below, the Chaski Worker is `chaski` and every resource is named after it
(`chaski-deliveries`). When the account may already hold another app’s Chaski, name the Worker
`<app>-chaski` and derive the rest from it. The app’s binding names the Worker, so the two always
match.

## 1. Read the app

Write down:

- **The app’s Worker**: its Wrangler config (`wrangler.jsonc`, `wrangler.json` or `wrangler.toml`;
  in a monorepo, the Worker that will send), its `name` and `compatibility_date`, its `env` blocks
  (each environment gets a Chaski of its own) and the `services` it already declares.
- **The Hono app** and the `hono` version in `package.json`, or the Worker’s own `fetch` handler
  when it has no Hono.
- **The package manager**, from the lockfile: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
  `bun.lock`.
- **How the app knows who is signed in**: the session middleware or auth library, and what it puts
  on the context (`c.get('user')`, a JWT claim, a cookie lookup). It becomes `identify` in step 5.
- **The frontend**, if any: served from this Worker’s `assets`, from another Worker or Pages
  project, or from another host, and whether that’s the origin of the app’s routes.
  [browser-clients.md](browser-clients.md) picks it up after step 6.
- **The dev command** and the port it serves on.
- **The features**: ask the user which channels (email, in-app, web push, iOS and macOS, Android,
  Windows), and whether they want scheduling and email attachments. They decide the bindings
  (SKILL.md, “Bindings decide features”).

When the app doesn’t run on Cloudflare Workers, stop and tell the user: it can’t bind to Chaski.

**Done when** you can name each item above, or know it doesn’t exist.

## 2. Choose where the Chaski project lives

Ask the user:

1. **A folder of the app’s repository**, such as `chaski/`: one change updates Chaski and the
   code that sends through it, under the same CI.
2. **A repository of its own**: when the team deploys infrastructure apart from the app.

**Done when** the user picked one and its folder exists.

## 3. Create the Chaski project

In that folder, write `package.json`:

```json
{
  "name": "chaski",
  "private": true,
  "type": "module",
  "scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy" }
}
```

Then install with the app’s package manager, from npm only (no Git URLs, tarballs or local copies
of the repository):

```sh
npm install chaskijs@latest hono   # or pnpm add / yarn add / bun add
npm install -D wrangler
```

When `node_modules/chaskijs/dist/worker/index.d.ts` is missing after the install, that version
predates the Chaski Worker. Tell the user which version installed
(`node_modules/chaskijs/package.json`) and what `npm view chaskijs dist-tags` lists, try
`chaskijs@next`, and stop when neither ships `dist/worker`.

The main module, the project’s only code:

```ts
// src/index.ts
export { ChaskiEntrypoint, ChaskiEvents, ChaskiFeed, ChaskiScheduler, default } from 'chaskijs/worker';
```

`wrangler.jsonc`, with every binding; keep only those the features from step 1 need:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "chaski",
  "main": "src/index.ts",
  "compatibility_date": "<today, 2026-04-21 or later>",
  "observability": { "enabled": true },
  "vars": {
    "CHASKI_ENVIRONMENT": "production",
    // The absolute production URL of the app's userRoutes() mount (step 5).
    "CHASKI_PUBLIC_URL": "https://app.example.com/me/notifications"
  },
  // wrangler dev signs this identity in to the local dashboard: the user's email.
  "access": {
    "dev": { "aud": "chaski-local", "identity": { "email": "you@example.com", "name": "You" } }
  },
  "d1_databases": [
    {
      "binding": "CHASKI_DB",
      "database_name": "chaski",
      // Until step 7 creates the database.
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "node_modules/chaskijs/migrations"
    }
  ],
  "queues": {
    "producers": [{ "binding": "CHASKI_QUEUE", "queue": "chaski-deliveries" }],
    "consumers": [
      {
        "queue": "chaski-deliveries",
        "max_batch_size": 10,
        "max_batch_timeout": 1,
        "max_retries": 5,
        "dead_letter_queue": "chaski-deliveries-dlq"
      }
    ]
  },
  "durable_objects": {
    "bindings": [
      { "name": "CHASKI_FEED", "class_name": "ChaskiFeed" },
      { "name": "CHASKI_EVENTS", "class_name": "ChaskiEvents" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChaskiFeed", "ChaskiEvents"] }],
  "workflows": [
    { "name": "chaski-scheduler", "binding": "CHASKI_SCHEDULER", "class_name": "ChaskiScheduler" }
  ],
  "r2_buckets": [{ "binding": "CHASKI_ATTACHMENTS", "bucket_name": "chaski-attachments" }],
  "send_email": [{ "name": "CHASKI_EMAIL" }]
}
```

- **`max_retries: 5`** is what Chaski counts on to tell a delivery’s last attempt.
- **`migrations`** lists only the Durable Object classes you bind; with neither bound, drop it.
- **`CHASKI_PUBLIC_URL`** is a real absolute URL or absent: a placeholder fails every call. Ask the
  user for the production URL of the mount; until they know it, leave the var out, since
  `.dev.vars` sets the local one (step 4).
- **`migrations_dir`** points from `wrangler.jsonc` to wherever `chaskijs/migrations` installed. A
  workspace that hoists packages puts it in a parent `node_modules`
  (`../node_modules/chaskijs/migrations`).

Add a `.gitignore` with `node_modules`, `.wrangler` and `.dev.vars`.

**Done when** `node_modules/chaskijs/dist/worker/index.d.ts` exists, `migrations_dir` reaches a
folder holding `0000_init.sql`, and `npx wrangler deploy --dry-run --outdir
"${TMPDIR:-/tmp}/chaski-dry-run"` builds in the Chaski project. That command bundles the Worker
and checks the config without deploying or signing in.

## 4. Create the local database

Write `.dev.vars` in the Chaski project, which only `wrangler dev` reads and which overrides
`vars`:

```sh
CHASKI_SECRET=<the output of: openssl rand -base64 32>
CHASKI_ENVIRONMENT=local
# The app's local port (step 6) and its mount path (step 5).
CHASKI_PUBLIC_URL=http://localhost:8788/me/notifications
```

Then apply Chaski’s migrations to the local database:

```sh
npx wrangler d1 migrations apply CHASKI_DB --local
```

Apply them again after every Chaski upgrade, and after `database_id` changes: a new id is a new,
empty local database.

**Done when** the command lists every file of `node_modules/chaskijs/migrations` as applied, or
reports nothing left to apply, and `git check-ignore .dev.vars` prints the file.

## 5. Bind the app and mount the user routes

In the app’s project:

1. **Install** `chaskijs` and `hono` (4.8 or later) with its package manager. The app takes the
   types and `userRoutes()` from it, a few kilobytes; Chaski’s own code stays in the Chaski Worker.
2. **Bind** to the Chaski Worker in the app’s Wrangler config:

   ```jsonc
   {
     "services": [{ "binding": "CHASKI", "service": "chaski", "entrypoint": "ChaskiEntrypoint" }]
   }
   ```

   ```toml
   [[services]]
   binding = "CHASKI"
   service = "chaski"
   entrypoint = "ChaskiEntrypoint"
   ```

   `service` is the Chaski Worker’s `name`. Wrangler doesn’t carry `services` into `env` blocks:
   each `env` block of the app declares its own, naming that environment’s Chaski
   (`chaski-staging` for `staging`), which step 7 creates.
3. **Type** the binding in the app’s `Env`:

   ```ts
   import type { ChaskiEntrypoint } from 'chaskijs';

   export type Env = { CHASKI: Service<ChaskiEntrypoint> /* …the app's other bindings */ };
   ```

   When the app generates `Env` with `wrangler types`, check the type it gives `CHASKI`; anything
   other than `Service<ChaskiEntrypoint>` gets declared over in the app’s own type.
4. **Check the compatibility date.** Before `2026-04-21`, Chaski’s errors reach the app without
   their `code`. Moving the date changes the runtime’s behavior for the whole app, so ask the user
   first.
5. **Mount the user routes**, after the app’s session middleware so `identify` can read what it
   set:

   ```ts
   import { userRoutes } from 'chaskijs';

   app.route(
     '/me/notifications',
     userRoutes<AppEnv>({
       chaski: (c) => c.env.CHASKI,
       identify: (c) => c.get('user')?.id ?? null,
     }),
   );
   ```

   - `identify` returns the signed-in user’s id, the same id sends use as `recipient.id`, which
     keys their feed, devices and preferences; `null` answers 401, and a `Response` is returned as
     is. Chaski takes the contact from it alone, never from what the browser sends.
   - `allowedOrigins` lists the frontend’s origins when it’s served from another one
     ([browser-clients.md](browser-clients.md) adds the CORS it needs).
   - `groups` is `['feed', 'push', 'preferences']` by default. A second inbox, such as one a team
     shares, is a second mount whose `identify` names another contact (`team:<id>`), with
     `groups: ['feed']`: a browser belongs to one contact, so registering it there would take it
     from the user’s own inbox. When the app keeps a preferences API of its own, leave
     `preferences` out of every mount, so the browser can’t write around its rules.
   - `allowPush: (c, id) => boolean` answers 403 to contacts that may not register a device.
   - An app with no frontend for notifications still mounts it for the email open pixel
     (`GET <mount>/t/o/:id`), with `groups: []` and `identify: () => null`.

   `CHASKI_PUBLIC_URL` in the Chaski project is this mount’s absolute URL: its production URL in
   `vars`, its local one in `.dev.vars`.

   A Worker without Hono gives these paths a Hono app of their own, and forwards them to it:

   ```ts
   const chaskiApp = new Hono<{ Bindings: Env }>().route(
     '/me/notifications',
     userRoutes({ chaski: (c) => c.env.CHASKI, identify }),
   );

   export default {
     fetch: (request, env, ctx) =>
       new URL(request.url).pathname.startsWith('/me/notifications/')
         ? chaskiApp.fetch(request, env, ctx)
         : handleRequest(request, env, ctx), // the Worker's own handler
   } satisfies ExportedHandler<Env>;
   ```

**Done when** the app’s typecheck passes and `npx wrangler deploy --dry-run --outdir
"${TMPDIR:-/tmp}/app-dry-run"` builds the app.

## 6. Run both locally

Start each dev server in the background, as a process of your own, Chaski first, and stop only
the PIDs you started:

- In the Chaski project, `npx wrangler dev`: port 8787, where the dashboard answers.
- In the app, its dev command on another port, such as `npx wrangler dev --port 8788`. Its
  `CHASKI` binding finds the local Chaski by name.

Then check each of these, in order:

1. **Both run and see each other.** `curl -s -o /dev/null -w '%{http_code}\n'
   http://localhost:8787/` prints `200`, since Wrangler signs in the `access.dev` identity, and the
   app’s startup log lists the `CHASKI` binding as `[connected]`.
2. **Chaski is ready.** Add a temporary route to the app, and call it:

   ```ts
   app.get('/dev/chaski', async (c) => c.json(await c.env.CHASKI.ready()));
   ```

   A fresh setup answers `{ "channels": [], "paused": [], "environment": "local", "templates": 0 }`.
   An error names what to fix: [troubleshooting.md](troubleshooting.md).
3. **The channels are on.** Set up each channel the user picked on the **Channels** page of the
   local dashboard, http://localhost:8787: with a browser tool when you have one, otherwise walk
   the user through it. https://chaski.sh/docs/channels lists each field.
   - **Email**: a sender address. Any address works locally, since every email stays on disk;
     production needs one on the domain onboarded to Email Service.
   - **In-app**: turning it on is the setting.
   - **Web push**: a **Contact** (`mailto:` an address of the team) and a key pair: **Generate keys**,
     or paste the pair the app already sends with when browsers are subscribed to it
     ([plan.md](plan.md) brings them over).
   - **APNs, FCM, WNS**: credentials only the user holds (the `.p8` key, the service account
     JSON, the Entra client secret). They paste them on that page, the one place they go.

   `/dev/chaski` lists each channel under `channels`.
4. **A template exists.** Sending a type without one fails. Write a `welcome` template, with
   content for each channel the user picked, into a scratch template file,
   `.wrangler/chaski-check.json` in the Chaski project, and load it ([sending.md](sending.md) has
   the format and the commands). `/dev/chaski` counts `templates` at 1 or more.
5. **A send goes through.** Add a second temporary route, and call it:

   ```ts
   app.post('/dev/chaski-send', async (c) =>
     c.json(
       await c.env.CHASKI.send({
         type: 'welcome',
         recipient: { id: 'dev-user', email: 'dev@example.com', name: 'Dev' },
         payload: {},
       }),
     ),
   );
   ```

   The result’s `outcome` is `delivered`. A delivery with `status: 'skipped'` carries a `reason`,
   which [troubleshooting.md](troubleshooting.md) explains; `push` skips with `no_device_tokens`
   until a browser enables push.
6. **The deliveries went out.** `curl -s
   http://localhost:8787/cdn-cgi/local/explorer/api/local/email/sending` lists the email, which
   the Chaski session keeps under its `.wrangler/tmp/email/`, and the dashboard’s **Deliveries**
   shows each delivery `sent` within seconds of the send.
7. **A schedule fires**, when the user turned scheduling on. Have the send route call
   `c.env.CHASKI.schedule()` with the same request, an `idempotencyKey` and
   `scheduledAt: new Date(Date.now() + 20_000).toISOString()`, then return
   `await c.env.CHASKI.schedules().list()`: the schedule is listed. Once the time passes, it leaves
   that list and its deliveries show up as in check 6.

Take the temporary routes out once the checks pass.

**Done when** every check that applies passes, and you reported each result to the user.

## 7. Go to production

Only when the user asks, and with their yes for each command that touches the account. In the
Chaski project:

```sh
npx wrangler d1 create chaski                     # its id replaces database_id
npx wrangler queues create chaski-deliveries
npx wrangler queues create chaski-deliveries-dlq
npx wrangler r2 bucket create chaski-attachments  # only with attachments
openssl rand -base64 32 | npx wrangler secret put CHASKI_SECRET
npx wrangler d1 migrations apply CHASKI_DB --remote
npx wrangler deploy
```

Before `deploy`, check that `CHASKI_ENVIRONMENT` in `vars` names production, and that
`CHASKI_PUBLIC_URL` is the production URL of the app’s mount, or absent while the user doesn’t
know it yet, which only leaves emails without the open pixel. The Durable Objects and the Workflow are created by the
deploy. The app deploys its binding after Chaski is up, since a service binding needs its Worker
to exist; that deploy is the user’s, like any other of the app. The template file then loads into
production with `--remote` ([sending.md](sending.md)); ask for that too.

Then hand the user what is theirs to do:

1. **Turn on Cloudflare Access.** Until it covers the Worker’s URL, the dashboard answers
   **Chaski needs Cloudflare Access**. In the Cloudflare dashboard: the Chaski Worker, **Settings**
   › **Domains & Routes**, **Enable Cloudflare Access** on its workers.dev URL; then choose who
   gets in, in the Access application it creates under **Zero Trust** › **Access** ›
   **Applications**. Access from the Worker’s own **Access** tab refuses the WebSocket the
   dashboard’s live updates use. A custom domain needs an Access application of its own, in Zero
   Trust. Everyone Access lets in can do everything in the dashboard, pauses included, so the
   policy is the whole permission model.
2. **Save the production channel settings** on the deployed dashboard’s **Channels** page: the
   email sender on the domain onboarded to Email Service (it needs the Workers Paid plan), the web
   push key pair, the APNs, FCM and WNS credentials, and the types muted by default.

**Done when** the deploy printed the Worker’s URL, and the user confirms the dashboard opens for
them through Access and its **Channels** page shows the channels they turned on.

### More environments

Each other environment of the app, such as `staging`, gets a Chaski of its own, with the user’s
yes for each command again:

- **Resources** under names of their own: `chaski-staging`, `chaski-staging-deliveries`,
  `chaski-staging-deliveries-dlq`.
- **An `env.staging` block** in the Chaski project’s `wrangler.jsonc` that repeats every binding
  and var with that environment’s names, since Wrangler carries neither into an environment. Its
  Workflow takes a name of its own (`chaski-staging-scheduler`): Workflow names are unique in the
  account. Wrangler names the Worker `chaski-staging`. https://chaski.sh/docs/environments has the
  whole block.
- **`--env staging`** on every command: the secret, the remote migrations and the deploy.
- **The app’s `env.staging` block** binds `CHASKI` to `chaski-staging`.
- **Access and channel settings** for that Worker, the user’s again. Settings never move between
  environments.

**Done when** each environment’s deploy printed its URL and the app’s matching environment binds to
it.

## Upgrade

Update `chaskijs` in the Chaski project, and in the app for its types. Apply the migrations
locally, then with `--remote` in each environment (with the user’s yes, staging first), and deploy
each environment after its migrations: Chaski refuses to run against a database that misses one.

**Done when** `env.CHASKI.ready()` answers without an error in every upgraded environment: from
the app’s health route, or locally from the temporary route of step 6.
