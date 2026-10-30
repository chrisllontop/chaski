# Set up Chaski next to an app

Work through the steps in order. Each ends on a **Done when** line; start the next step only once
it holds. Steps 1 to 6 run on the user’s machine and touch nothing in their Cloudflare account;
step 7 does, with their yes. The same guide for people: https://chaski.sh/docs/install and
https://chaski.sh/docs/connect.

The binding names (`CHASKI_DB`…), the class names and `ChaskiEntrypoint` are fixed. The Worker’s
name is yours to choose: below it is `chaski`, and `chaskijs init` names every resource after it
(`chaski-deliveries`). When the account may already hold another app’s Chaski, name the Worker
`<app>-chaski`. The app’s binding names the Worker, so the two always match.

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
- **The languages**: whether the app sends in more than one (an i18n library, message catalogs,
  emails per language), its default, and the others. The user saves them under **Languages** on
  **Channels** in each environment, before templates with translations load
  ([sending.md](sending.md), Languages).
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

**Done when** the user picked one: `--folder` or `--repo` in step 3.

## 3. Create the Chaski project

From the folder that will hold it (the app’s repository root for a folder of it, or the parent of
the new repository), run `chaskijs init` with a flag for every answer, since it can’t ask without a
terminal. Run it with the app’s package manager (`pnpm dlx`, `yarn dlx`, `bunx` in place of `npx`):
it installs with the one that runs it.

```sh
npx chaskijs@next init chaski --folder --name chaski --public-url https://app.example.com/me/notifications
```

- **`--folder`** or **`--repo`**, from step 2. `--repo` runs `git init` in the new folder.
- **`--name`**: the Worker’s name. The database takes it, the queues `<name>-deliveries` and
  `<name>-deliveries-dlq`, the Workflow `<name>-scheduler`, the bucket `<name>-attachments`.
- **`--no-email`** when the user doesn’t want email; **`--attachments`** when they want email
  attachments, which add an R2 bucket. In-app, scheduling and live updates are always declared.
- **`--public-url`**: the absolute production URL of the app’s `userRoutes()` mount (step 5). Ask
  the user; leave the flag out until they know it, which only leaves emails without the open pixel.
  A placeholder fails every call.

`@next` installs Chaski 0.1, in pre-release until it ships as `latest`; `npx chaskijs` alone runs
an older version without these commands. Use npm only (no Git URLs, tarballs or local copies of
the repository).

`init` writes `package.json`, `wrangler.jsonc`, the one-line `src/index.ts`, `.gitignore` and
`.dev.vars` (a random `CHASKI_SECRET`, `CHASKI_ENVIRONMENT=local`), installs `chaskijs`, `hono`
and `wrangler`, and applies Chaski’s migrations to the local database. It refuses a folder that
isn’t empty. Read the `wrangler.jsonc` it wrote: https://chaski.sh/docs/install#read-what-it-wrote
explains each binding. `database_id` stays `"local"` until step 7 creates the database.

- **`compatibility_date`**: keep the date in the generated `wrangler.jsonc`, the one Chaski’s own
  tests run on. Never set today’s: a later date must be no later than the project’s Wrangler’s
  workerd, which ships behind today, or `wrangler dev` warns and falls back.
- **`package.json` scripts**: `init` writes `dev` alone. Add none named after a package-manager
  command (`deploy`, `install`, `add`, `update`, `publish`): `pnpm deploy` runs pnpm’s own command,
  never the script. Call `npx chaskijs deploy` directly.

When the app’s repository is a workspace that hoists packages, point `migrations_dir` at the
hoisted copy (`../node_modules/chaskijs/migrations`): it has to reach the installed package’s
migrations folder from `wrangler.jsonc`.

**Done when** `npx wrangler deploy --dry-run --outdir "${TMPDIR:-/tmp}/chaski-dry-run"` builds in
the Chaski project, which bundles the Worker and checks the config without deploying or signing
in, and `git check-ignore .dev.vars` prints the file.

## 4. Point the local settings at the app

`.dev.vars` holds what only `wrangler dev` reads. When `init` got `--public-url`, it copied the
production URL there; make it the app’s local mount, at the port of step 6:

```sh
CHASKI_PUBLIC_URL=http://localhost:8788/me/notifications
```

Leave `CHASKI_SECRET` as `init` wrote it. After every Chaski upgrade, the migrations go to the local
database again; `npx chaskijs upgrade` does it.

**Done when** `.dev.vars` names the local mount, or the app has none yet.

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
   first. Move it to the date in the Chaski project’s generated `wrangler.jsonc`, or one no later
   than the app’s Wrangler’s workerd, never to today’s: `wrangler dev` warns and falls back past
   it.
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
   - An app that puts its routes behind a session or an origin check registers that pixel-only
     mount, `userRoutes({ chaski, identify: () => null, groups: [] })`, at the same path ahead of
     those gates: email clients load the pixel without a session, and webmail sends it
     `Sec-Fetch-Site: cross-site`.

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

Only when the user asks. In the Chaski project, signed in to Cloudflare (`npx wrangler whoami`;
the user runs `npx wrangler login` themselves). First check that `CHASKI_ENVIRONMENT` in `vars`
names production, and that `CHASKI_PUBLIC_URL` is the production URL of the app’s mount, or
absent while the user doesn’t know it yet.

Then get the plan. Without a terminal and without `--yes`, `deploy` only reads the account, prints
what it would do and stops:

```sh
npx chaskijs deploy
```

Show the user that list: the resources it creates (database, queues, the bucket with
attachments), the migrations it applies to the deployed database, and the deploy, which carries a
new `CHASKI_SECRET` on the Worker’s first deploy. With their yes, and only then:

```sh
npx chaskijs deploy --yes
```

It writes the new database’s id into `wrangler.jsonc`, applies the migrations before the code, and
prints the Worker’s URL. On the first deploy, the secret goes up with the Worker
(`wrangler deploy --secrets-file`, from a file it writes readable by the user only and deletes), so
the Worker never runs without one. A Worker that already runs without it gets `secret put` right
after the deploy. By hand, keep the same order: never run `wrangler secret put` against a Worker
that hasn’t been deployed. Until the Worker exists, `secret put` creates an empty one under
that name, and an app deployed then binds to a Worker without `ChaskiEntrypoint`. The local
database follows `database_id`, so `wrangler dev` starts over on a new one, which the deploy
migrates. The app deploys its binding after Chaski is up, since a
service binding needs its Worker to exist; that deploy is the user’s, like any other of the app.
The template file then loads into production with `--remote` ([sending.md](sending.md)); ask for
that too. A file with translations waits until the user saved the languages (item 2 below).

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
   push key pair, the APNs, FCM and WNS credentials, the types muted by default, and the
   **Languages**, with the default the template file names, when it has translations.

**Done when** the deploy printed the Worker’s URL, and the user confirms the dashboard opens for
them through Access and its **Channels** page shows the channels they turned on.

### More environments

Each other environment of the app, such as `staging`, gets a Chaski of its own:

```sh
npx chaskijs env add staging --public-url https://staging.example.com/me/notifications
```

It adds `env.staging` to `wrangler.jsonc`, repeating every binding with that environment’s names
(`chaski-staging`, `chaski-staging-deliveries`, `chaski-staging-scheduler`), since Wrangler carries
neither bindings nor vars into an environment. Wrangler names its Worker `chaski-staging`. Then, as
in step 7, show the user the plan of `npx chaskijs deploy --env staging`, and run it with `--yes`
only on their yes. Its first deploy carries that Worker’s own `CHASKI_SECRET`
(`wrangler deploy --env staging --secrets-file <file>` by hand); `wrangler secret put --env
staging` comes only once `chaski-staging` runs, since until the Worker exists, `secret put` creates
an empty one under its name. The app’s `env.staging` block binds `CHASKI` to `chaski-staging`, and
Access and the channel settings of that Worker are the user’s again: settings never move between
environments.

**Done when** each environment’s deploy printed its URL and the app’s matching environment binds to
it.

## Upgrade

In the Chaski project:

```sh
npx chaskijs upgrade --tag next   # --tag latest once 0.1.0 is released
```

It installs that `chaskijs`, has it bring `wrangler.jsonc` and `src/index.ts` up to what the new
version needs in every environment (it reports each change), applies the migrations locally and
prints a deploy per environment. Update `chaskijs` in the app too, for its types. Each deploy
applies the migrations before the code: show the user each plan and deploy with their yes,
staging first.

**Done when** `env.CHASKI.ready()` answers without an error in every upgraded environment: from
the app’s health route, or locally from the temporary route of step 6.
