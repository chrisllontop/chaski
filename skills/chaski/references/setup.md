# Set up Chaski in a Worker

Work through the steps in order. Each ends on a **Done when** line; start the next step only once
it holds. Resource and binding names below (`CHASKI_DB`, `my-app-deliveries`,
`/admin/notifications`) are examples to adapt; the class names `ChaskiFeed`, `ChaskiEvents`,
`ChaskiScheduler` and `ChaskiEntrypoint` are fixed. The same guide for people:
https://chaski.sh/docs/install.

## 1. Survey the project

Read the project and write down:

- **The Worker.** Its Wrangler config (`wrangler.jsonc`, `wrangler.json` or `wrangler.toml`; in a
  monorepo, the one for the Worker that will host Chaski), its `main` module and
  `compatibility_date`, and what it already declares under `d1_databases`, `queues`,
  `durable_objects`, `migrations` (note the last tag), `workflows`, `triggers` and `assets`.
- **The default export** of the main module: `export default app`, or an object with `fetch` and
  maybe `queue` and `scheduled`.
- **The Hono app** and the `hono` version in `package.json`.
- **The package manager**, from the lockfile: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
  `bun.lock`.
- **How the app knows who is signed in**: the session middleware or auth library, and what it puts
  on the context (`c.get('user')`, a JWT claim, a cookie lookup).
- **Who should see the dashboard**: an admin or staff role in the app, a Cloudflare Access
  application in front of it, or neither.
- **The frontend**, if any: served from this Worker’s `assets`, from another Worker or Pages
  project, or from another host. [browser-clients.md](browser-clients.md) picks it up after step 7.
- **The dev command**: `wrangler dev`, or `vite dev` with `@cloudflare/vite-plugin`.

Stop and tell the user before going further when:

- The code doesn’t run on Cloudflare Workers. Chaski can’t run there.
- The Worker doesn’t use Hono. Chaski’s routes are Hono apps, so Chaski fits only if the user
  agrees to add `hono` for Chaski’s paths alone (step 5 shows how).

**Done when** you can name each item above, or know it doesn’t exist.

## 2. Install the package

Add the latest `chaskijs` from npm with the project’s package manager:

```sh
pnpm add chaskijs@latest   # or npm install / yarn add / bun add
```

Add `hono` the same way when it’s missing or older than 4.8. Install from npm only: no Git URLs,
tarballs or local copies of the repository. When the user is trying a pre-release, install
`chaskijs@next` instead; `npm view chaskijs dist-tags` shows what `latest` and `next` hold.

**Done when** `node_modules/chaskijs/dist/index.d.ts` and
`node_modules/chaskijs/migrations/0000_init.sql` exist next to the Worker. In a monorepo the package
may sit in the root `node_modules` instead; note the path from the Wrangler config’s folder to
`chaskijs/migrations`, since step 3 needs it.

When the install succeeds but `dist/index.d.ts` is missing, npm served a version older than this
guide: `0.0.1` only reserved the name and ships no code. Tell the user which version installed
(`node_modules/chaskijs/package.json`) and which is the latest (`npm view chaskijs version`), and
stop here until a release that ships `dist` is out. Don’t reach for the repository or a tarball
instead.

## 3. Declare the bindings

Agree with the user on what to turn on, then declare only what that needs:

| Feature | Binding | Also needs |
| --- | --- | --- |
| Always | `CHASKI_DB` (D1), `CHASKI_QUEUE` (queue producer and consumer) | |
| Email | `send_email` | The Workers Paid plan and a domain onboarded to [Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/) |
| In-app feed | `ChaskiFeed` Durable Object | |
| Web push, iOS and macOS push, Android push, Windows push | none | Keys (step 6) |
| `chaski.schedule()` | `ChaskiScheduler` Workflow | |
| Live dashboard | `ChaskiEvents` Durable Object | |
| Email attachments | R2 bucket | |

Everything, in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    // The absolute URL of the dashboard's mount (step 5), in production; ask the user.
    "CHASKI_PUBLIC_URL": "https://app.example.com/admin/notifications",
    "VAPID_PUBLIC_KEY": "<public key from step 6>"
  },
  "d1_databases": [
    {
      "binding": "CHASKI_DB",
      "database_name": "my-app-chaski",
      "database_id": "<id printed by wrangler d1 create>",
      // Relative to this file; Chaski's tables come from the package.
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
    { "name": "my-app-chaski-scheduler", "binding": "CHASKI_SCHEDULER", "class_name": "ChaskiScheduler" }
  ],
  "r2_buckets": [{ "binding": "CHASKI_ATTACHMENTS", "bucket_name": "my-app-attachments" }],
  "send_email": [{ "name": "CHASKI_EMAIL" }]
}
```

The same in `wrangler.toml`:

```toml
[vars]
CHASKI_PUBLIC_URL = "https://app.example.com/admin/notifications"
VAPID_PUBLIC_KEY = "<public key from step 6>"

[[d1_databases]]
binding = "CHASKI_DB"
database_name = "my-app-chaski"
database_id = "<id printed by wrangler d1 create>"
migrations_dir = "node_modules/chaskijs/migrations"

[[queues.producers]]
binding = "CHASKI_QUEUE"
queue = "my-app-deliveries"

[[queues.consumers]]
queue = "my-app-deliveries"
max_batch_size = 10
max_batch_timeout = 1
max_retries = 5
dead_letter_queue = "my-app-deliveries-dlq"

[[durable_objects.bindings]]
name = "CHASKI_FEED"
class_name = "ChaskiFeed"

[[durable_objects.bindings]]
name = "CHASKI_EVENTS"
class_name = "ChaskiEvents"

[[migrations]]
tag = "chaski-v1"
new_sqlite_classes = ["ChaskiFeed", "ChaskiEvents"]

[[workflows]]
name = "my-app-chaski-scheduler"
binding = "CHASKI_SCHEDULER"
class_name = "ChaskiScheduler"

[[r2_buckets]]
binding = "CHASKI_ATTACHMENTS"
bucket_name = "my-app-attachments"

[[send_email]]
name = "CHASKI_EMAIL"
```

Merge these into the existing config; every entry the Worker already has stays as it is:

- **D1.** Chaski gets a database of its own: a D1 binding takes its migrations from one folder,
  and that folder is the package’s. In a monorepo, point `migrations_dir` at wherever step 2 found
  the package, such as `../../node_modules/chaskijs/migrations`.
- **Durable Object migrations.** When the config already has `migrations`, add Chaski’s entry
  after the last one with a tag of its own, and list only the Chaski classes you bind. With
  neither `ChaskiFeed` nor `ChaskiEvents` bound, add no entry.
- **The queue** is Chaski’s alone. Chaski handles only batches whose every message is one of its
  deliveries, so a queue shared with the host’s own messages stalls both.
- **The Workflow’s `name`** is unique across the Cloudflare account, so prefix it with the Worker’s
  name.
- **`CHASKI_PUBLIC_URL`** is the production URL of the dashboard’s mount. When the user doesn’t
  know it yet, leave a placeholder: `.dev.vars` sets the local one (step 7), and step 8 checks it
  before deploying.
- **Remote resources come later.** `wrangler dev` simulates every binding locally, so nothing has
  to exist in the account yet. Until the user creates the database (step 8), use
  `00000000-0000-0000-0000-000000000000` as `database_id`. A new id later means a new, empty local
  database: apply the migrations again (step 4).

If the project generates its types with `wrangler types`, run it again now. Its generated `Env`
works as Chaski’s bindings as is.

**Done when** each feature the user picked has its bindings declared, and every entry the config
had before keeps its values.

## 4. Create the local tables

```sh
npx wrangler d1 migrations apply CHASKI_DB --local
```

Add `-c <path>` when the config isn’t in the current folder. Run it again after every Chaski
upgrade: Chaski refuses to run against a database that misses one of its migrations.

**Done when** the command lists `0000_init.sql` and every later file in
`node_modules/chaskijs/migrations` as applied, or reports nothing left to apply.

## 5. Mount Chaski

### The config

Create the `chaski` object once, in a module of its own that the main module imports, so any file
can import it without a circular import. Leave out the bindings and channels the user didn’t pick
in step 3:

```ts
// src/chaski.ts
import {
  type ChaskiEvents,
  type ChaskiFeed,
  createChaski,
  type DeliveryMessage,
  type ScheduleParams,
  type SendEmailBinding,
} from 'chaskijs';

export type Env = {
  CHASKI_PUBLIC_URL: string;
  // `local` only in .dev.vars; deployed environments name themselves, or leave it unset.
  ENVIRONMENT?: string;
  // The dashboard sign-in's values (below): keep the ones it uses.
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
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

// Chaski calls this on every request, so vars and secrets always come from the current env.
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
  environment: env.ENVIRONMENT,
}));
```

When the project already names its environment in a variable, pass that one as `environment`
instead of adding `ENVIRONMENT`. Chaski acts only on the exact value `local`, which opens the
dashboard without `authorize`, so check that only `.dev.vars` (or `.env`) produces it; when the
project's local value is another word, such as `development`, and a deployed environment shares
it, add `ENVIRONMENT` rather than mapping that word to `local`.

When the project already has an `Env` type, from `wrangler types` or by hand, add the fields to it
and use it here instead. An `Env` declared in the main module moves into `src/chaski.ts` (or a
`src/env.ts` both import), since importing it from the main module here would be circular. Every option is in
`node_modules/chaskijs/dist/server/config.d.ts`; `email.from` must be an address on the domain
onboarded to Email Service.

### Sign-in to the dashboard

`authorize` runs before every page and API call of the dashboard. It returns `{ id, name? }` for
someone allowed in, `null` to answer 403, or a `Response` such as a redirect to a login page; the
`id` signs every admin action. Pick by what step 1 found, and ask the user when it found nothing
clear:

- **The app has an admin or staff role:** write `authorize` over the app’s own session. Pass the
  app’s Hono env type to `chaski.routes()`, and `c` reads what its session middleware set:

  ```ts
  chaski.routes<AppEnv>({
    dashboard: {
      authorize: (c) => {
        const user = c.get('user');
        return user?.isAdmin ? { id: user.email, name: user.name } : null;
      },
    },
  });
  ```

- **The team uses Cloudflare Access:** `cloudflareAccess({ teamDomain, audience })` checks the
  token of an Access application that covers the mount path; `audience` is that application’s AUD
  tag. Access doesn’t sit in front of `wrangler dev`; `environment: 'local'` (step 7) opens the
  local dashboard without it, so `authorize` needs no local branch:

  ```ts
  authorize: cloudflareAccess({
    teamDomain: 'example.cloudflareaccess.com',
    audience: '<Access application AUD tag>',
  }),
  ```

- **Neither:** `basicAuth({ username, password })`, with both kept as secrets. Build it inside
  `authorize`, so the secrets come from the request’s env:

  ```ts
  authorize: (c) =>
    basicAuth({ username: c.env.ADMIN_USER ?? '', password: c.env.ADMIN_PASSWORD ?? '' })(c),
  ```

Both helpers take the app’s Hono env, so they work under `chaski.routes<AppEnv>()` as written.

Ask the user who may **pause** a channel from the dashboard, its emergency brake: a paused
channel holds every delivery, password resets included, until someone resumes it and sends or
discards what it held. `canPauseChannels: (c, actor) => boolean` next to `authorize` decides it,
over the same role or list (`actor.id` is what `authorize` returned); without it nobody can pause,
except in the `local` environment.

### The user routes

`chaski.userRoutes()` serves the signed-in user’s feed, devices and preferences to the frontend.
`identify` returns that user’s id from the app’s own session (the id Chaski keys their feed,
devices and preferences by, the same one sends use as `recipient.id`), or `null` to answer 401.
Middleware the host registers before `.route()` runs for these paths too, so `identify` can read
what the session middleware set. Pass the app’s Hono env type to type `c`:

```ts
chaski.userRoutes<AppEnv>({ identify: (c) => c.get('user')?.id ?? null });
```

Skip the user routes when the project has no signed-in users or no frontend that shows
notifications.

A second inbox for the same user, such as one their team shares, is a second mount on another
path whose `identify` names another contact (`team:<id>`), with `groups: ['feed']`: a browser
belongs to one contact, so registering it on that mount would take it from the user’s own inbox.
When the project keeps a preferences API of its own, with rules of its own, leave `preferences`
out of `groups` on every mount, so the browser can’t write around them. `allowPush: (c, id) =>
boolean` answers 403 to the contacts that may not register a device.

### The main module

```ts
// src/index.ts, the Worker's main module
import { Hono } from 'hono';
import { chaski, type Env } from './chaski';
import type { User } from './session'; // the app's own

// The bindings find Chaski's classes through the main module's exports; export the ones you bind.
export { ChaskiEvents, ChaskiFeed, ChaskiScheduler } from 'chaskijs';

// The app's own Hono env: Variables holds what its session middleware sets.
type AppEnv = { Bindings: Env; Variables: { user: User | null } };

const app = new Hono<AppEnv>()
  // …the app's own middleware and routes, its session middleware first
  .route(
    '/admin/notifications',
    chaski.routes<AppEnv>({
      dashboard: {
        // Whichever of the three sign-ins above the user chose; here, the app's own admins.
        authorize: (c) => {
          const user = c.get('user');
          return user?.isAdmin ? { id: user.email } : null;
        },
      },
    }),
  )
  .route(
    '/me/notifications',
    chaski.userRoutes<AppEnv>({ identify: (c) => c.get('user')?.id ?? null }),
  );

export default {
  fetch: app.fetch,
  queue: async (batch, env, ctx) => {
    // chaski.queue() returns false for a batch from any other queue.
    if (await chaski.queue(batch, env, ctx)) return;
    // the host's other queues, if any
  },
} satisfies ExportedHandler<Env>;
```

- `export default app` becomes the object above, keeping any `scheduled` or other handler the
  Worker already exports.
- When the project already has a `queue` handler, call `chaski.queue()` first and fall through to
  the existing code when it returns `false`.
- When the host sets security headers for every path (Hono’s `secureHeaders()` with a
  `contentSecurityPolicy`, say), skip the dashboard’s mount path. The dashboard sends a policy of
  its own with a per-load nonce, and its email preview is a document the dashboard frames; the
  host’s headers would overwrite the first and block the second.

  ```ts
  const headers = secureHeaders({ contentSecurityPolicy: { /* the host's */ } });
  app.use('*', (c, next) =>
    c.req.path.startsWith('/admin/notifications') ? next() : headers(c, next),
  );
  ```

- A Worker without Hono adds `hono` and gives Chaski’s paths a Hono app of their own, then forwards
  those paths to it from its `fetch` handler:

  ```ts
  const chaskiApp = new Hono<{ Bindings: Env }>()
    .route('/admin/notifications', chaski.routes({ dashboard: { authorize } }))
    .route('/me/notifications', chaski.userRoutes({ identify }));

  export default {
    fetch: (request, env, ctx) => {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith('/admin/notifications') || pathname.startsWith('/me/notifications')) {
        return chaskiApp.fetch(request, env, ctx);
      }
      return handleRequest(request, env, ctx); // the Worker's own handler
    },
    queue: async (batch, env, ctx) => {
      if (await chaski.queue(batch, env, ctx)) return;
    },
  } satisfies ExportedHandler<Env>;
  ```

**Done when** the project’s typecheck passes and
`npx wrangler deploy --dry-run --outdir /tmp/chaski-dry-run` builds without errors. That command
bundles the Worker and checks the config without deploying or signing in.

## 6. Add the push keys

Skip this step without push.

**Web push** needs a VAPID key pair. When the project already sends web push with a pair of its
own, use that pair: the browsers it subscribed keep working ([plan.md](plan.md) moves them).
Otherwise generate one:

```sh
npx web-push generate-vapid-keys --json
```

`publicKey` goes in `vars` as `VAPID_PUBLIC_KEY`. `vapid.subject` in the config is a
`mailto:` or `https:` contact the push services can reach the team at; ask the user for it. `privateKey` is a secret: put it in `.dev.vars`
for local runs, and set it in the account at deploy time (step 8). Keep the pair once browsers
subscribe: a subscription made with another public key can never receive this server’s pushes.

**iOS and macOS push** need an APNs key (`.p8`) from the user’s Apple developer account, its key
id, their team id, and the bundle id of each app: one key sends to every app of the team. Add
`apns` next to `vapid`, with an entry per app and `environment: 'sandbox'` for development builds,
`'production'` for TestFlight, App Store, Mac App Store and Developer ID builds:

```ts
apns: {
  teamId: '<Apple team id>',
  keyId: '<APNs key id>',
  privateKey: env.APNS_PRIVATE_KEY, // the contents of the .p8 file
  ios: { bundleId: 'com.example.app', environment: 'production' },
  macos: { bundleId: 'com.example.desktop', environment: 'production' }, // a Mac or Electron app
},
```

A device may register with an `environment` of its own, which overrides its app’s: a development
build that shares the config registers with `environment: 'sandbox'`.

**Android push** needs a service account key from the user’s Firebase project, the one the app
registers its tokens with: **Project settings → Service accounts → Generate new private key**
downloads a JSON file. Add `fcm` next to `vapid`, and set the whole file as the
`FCM_SERVICE_ACCOUNT` secret (`npx wrangler secret put FCM_SERVICE_ACCOUNT < service-account.json`):

```ts
fcm: {
  serviceAccount: env.FCM_SERVICE_ACCOUNT, // the contents of the JSON key file
},
```

**Windows push** needs the Microsoft Entra app registration the Windows app creates its channel
with, through the Windows App SDK’s `PushNotificationManager`: its directory (tenant) id, its
application (client) id and a client secret, set as the `WNS_CLIENT_SECRET` secret. Partner Center
credentials (a package SID) are a different model, which the Windows App SDK doesn’t use:

```ts
wns: {
  tenantId: '<directory (tenant) id>',
  clientId: '<application (client) id>',
  clientSecret: env.WNS_CLIENT_SECRET,
},
```

**Done when** the keys are in place and the secrets live only in `.dev.vars` and, later, the
account. `.dev.vars` must be in `.gitignore`.

## 7. Run it locally

Set the local values in `.dev.vars`, which overrides `vars` under `wrangler dev`:

```sh
CHASKI_PUBLIC_URL=http://localhost:8787/admin/notifications
# Opens the local dashboard without authorize; needs CHASKI_PUBLIC_URL on localhost.
ENVIRONMENT=local
# The sign-in's values, if it has any: ADMIN_USER and ADMIN_PASSWORD.
# With web push: VAPID_PRIVATE_KEY.
# With Android push: FCM_SERVICE_ACCOUNT='<the JSON key file>', in single quotes: double quotes
# turn the \n escapes of its private_key into line breaks, and the JSON no longer parses.
# With Windows push: WNS_CLIENT_SECRET.
```

Match `CHASKI_PUBLIC_URL` to the address `wrangler dev` prints and the mount path. Under
`wrangler dev` every email lands on disk, under `.wrangler/tmp/email/`, so nothing reaches a real
address. Start the project’s dev command, then check each of these, in order:

1. **The dashboard answers.** `curl -i http://localhost:8787/admin/notifications/` answers `200`
   and HTML, with no credentials while `ENVIRONMENT=local`. To check the sign-in itself, run once
   without it: `-u` for `basicAuth()`, the app’s session cookie (`-b 'session=…'`) for its own
   sign-in; Access answers 403 locally.
2. **Chaski read the config.** Ask the user to open the dashboard’s **Channels** page: the header
   says **Local**, and it shows the channels they picked as enabled.
3. **A template exists.** Sending a type without one fails. Write a `welcome` template, with a
   subject and a body for each channel the user picked, into a scratch template file,
   `.wrangler/chaski-check.json`, and load it ([sending.md](sending.md) has the format and the
   commands). The project’s `chaski-templates.json` holds the types it sends. **Templates**
   lists `welcome`.
4. **A send goes through.** Add a temporary route that only answers in the local environment, and
   call it:

   ```ts
   app.post('/dev/chaski-send', async (c) => {
     if (c.env.ENVIRONMENT !== 'local') return c.notFound();
     return c.json(
       await chaski.send({
         type: 'welcome',
         recipient: { id: 'dev-user', email: 'dev@example.com', name: 'Dev' },
         payload: {},
       }),
     );
   });
   ```

   The result’s `outcome` is `delivered`. Each delivery with `status: 'skipped'` carries a
   `reason`, and [troubleshooting.md](troubleshooting.md) says what each one means; `push` skips
   with `no_device_tokens` until a browser enables push.
5. **The delivery moved.** Ask the user to open the dashboard’s **Deliveries** page: each
   delivery shows `sent` once the local queue consumer ran, usually within seconds, and the log
   prints where the email landed. A delivery stuck at `pending` means the queue handler isn’t
   wired.
6. **A schedule fires**, when the user turned scheduling on. Have the temporary route call
   `chaski.schedule()` with the same send, an `idempotencyKey` and a `scheduledAt` 20 seconds
   out (`new Date(Date.now() + 20_000).toISOString()`), and return `chaski.schedules.list()`
   after it: the schedule is listed. Once the time passes, it leaves that list and its deliveries
   show up as in check 5.

Take the temporary route out once the checks pass.

**Done when** every check that applies passes. Report each result to the user.

## 8. Deploy

Only when the user asks, and with their go-ahead for each command that touches the account:

```sh
npx wrangler d1 create my-app-chaski          # then put the printed id in database_id
npx wrangler queues create my-app-deliveries
npx wrangler queues create my-app-deliveries-dlq
npx wrangler r2 bucket create my-app-attachments   # only for attachments
npx wrangler d1 migrations apply CHASKI_DB --remote
npx wrangler secret put VAPID_PRIVATE_KEY            # and the other secrets, never ENVIRONMENT
npx wrangler deploy
```

With the migrations applied, the project’s template file loads into production with `--remote`
([sending.md](sending.md)); ask for that too.

Before `deploy`, check that `CHASKI_PUBLIC_URL` in `vars` is the production URL of the mount,
that `ENVIRONMENT` is unset or names it (never `local`), that the email domain is onboarded to
Email Service, and that the Access application, if any, covers the mount path. The Durable Objects
and the Workflow are created by the deploy. Then open the dashboard: **Channels** shows what
Chaski picked up.

## Other Workers in the account

When the host’s other Workers need to send, export `ChaskiEntrypoint` from the host’s main module
next to the other classes, and give each of those Workers a service binding to it. Over RPC the
groups are methods: `env.CHASKI.feed().unreadCount(id)`, not `env.CHASKI.feed.unreadCount(id)`.
https://chaski.sh/docs/other-workers has the binding and the calls.
