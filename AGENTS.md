# Chaski

Notification infrastructure that runs as its own Cloudflare Worker, dashboard included: email, web
push, APNs, FCM, WNS and in-app notifications, with templates, preferences, scheduled sends, retries
and realtime events. Each environment of an app gets a Chaski Worker with resources of its own, and
the app calls it over a service binding. Open source (MIT), published on npm as `chaskijs`.

**Current stage: Chaski as its own Worker.** `chaskijs/worker` is the whole Worker. Its URL serves
the dashboard and its admin API, behind Cloudflare Access. `ChaskiEntrypoint` serves the app over
RPC (`env.CHASKI.send()`), and its `fetch()` serves the user routes and the open pixel, which the
app's `userRoutes()` (from `chaskijs`) forwards for the signed-in user. `chaskijs/client`,
`chaskijs/sw` and `chaskijs/react` wrap those routes for the page, the service worker and React.
Channels are set up on the dashboard's Channels page and stored in the Worker's own D1, their
secrets encrypted with the Wrangler secret `CHASKI_SECRET`; a channel with no saved settings is
off.

## Guides

The guides in `.agents/` hold the conventions of each area and are its source of truth. Read a
guide before the work it names and follow it; when a change alters a convention, update its guide
in the same change.

- `.agents/api.md`: the admin API under `/api/*`: route layout, request validation, error and
  success responses, resource IDs.
- `.agents/services.md`: business logic and persistence under `src/server/services/`:
  `BaseService`, the bindings, better-drizzle on D1.
- `.agents/database.md`: a table, column or migration in `src/server/db/schema/` or `migrations/`.
- `.agents/errors.md`: what a failure throws and where it shows: `ChaskiError`, `DeliveryError`,
  HTTP answers, background work.
- `.agents/types.md`: `null` versus `undefined` in zod inputs, service updates and response DTOs.
- `.agents/copy.md`: any user-facing text in the dashboard: labels, errors, empty states,
  confirmations.
- `.agents/git.md`: a commit message or a pull request.

## Run it

- `pnpm i` installs the dependencies (Node 24 and pnpm 12). `devEngines` holds contributors to
  Node 24 without putting that constraint on the people who install `chaskijs`.
- `pnpm dev` builds the dashboard and runs the fixture Worker (`test/fixture`) with Wrangler, as
  `CHASKI_ENVIRONMENT=local`; Wrangler keeps every email on disk, under
  `test/fixture/.wrangler/tmp/email/`, and signs in the identity under `access.dev` in its
  wrangler.jsonc, as Cloudflare Access would. The dashboard is at `/`, an app's user routes at
  `/app/notifications` and a shared inbox at `/app/team-notifications`; there is no hot reload,
  so rerun it after a dashboard change. Apply the migrations to the local D1 first:
  `pnpm wrangler d1 migrations apply CHASKI_DB --local -c test/fixture/wrangler.jsonc`.
  `curl -X POST localhost:8787/dev/seed` then saves the email and in-app settings as the Channels
  page does and fills it with sample templates, sends and schedules (`test/fixture/seed.ts`), so
  the dashboard has something to show. `pnpm dev` turns no channel on from code, as a deployed
  Chaski doesn't; the tests do.
- `pnpm build:dashboard` (Vite) writes `src/generated/dashboard.ts`, which the server code imports.
  It is generated and gitignored; run it once before typechecking or testing on a fresh clone.
- `pnpm typecheck` (tsc, ten projects), `pnpm lint` (Biome), `pnpm format` (Biome with fixes),
  `pnpm test` (Vitest in workerd), `pnpm build` (dashboard, tsdown, then the declarations).
- `pnpm dev:site` serves chaski.sh, landing and docs, with Vite. `pnpm build:site` prerenders every
  page to `site/dist/client` and writes their headers; `pnpm --filter chaski-site preview` serves
  that build as production does. Workers Builds publishes it (see CI); `pnpm deploy:site` is the
  manual fallback, and only the owner runs it.
- `pnpm drizzle-kit generate --name <name>` writes a migration into `migrations/` after a schema
  change; `.agents/database.md` says what else a migration needs.
- `pnpm check` builds the dashboard, then runs typecheck, lint and test, and builds the site: the
  same gate CI runs before the build.

## CI

- **Verify** (`.github/workflows/pull-request.yml`) runs on every pull request: `pnpm check` and
  `pnpm build` on Linux.
- **Release Drafter** keeps two drafts from merged pull requests (labels `breaking`,
  `feature`/`enhancement` pick the version bump; patch is the default; `v0.0.1` is the baseline):
  the next release (`v0.1.0`) and its next pre-release (`v0.1.0-rc.N`).
- **Release** runs when a `v*` release is published, from `main`, and publishes to npm with
  trusted publishing (OIDC, no token). A release's tag must match `package.json`'s version and
  goes out as `latest`. A pre-release's tag is that version with a suffix (`v0.1.0-rc.1` for
  `0.1.0`); the job takes its version from the tag and publishes it as `next`, so `latest` stays.
  Bump `package.json` to the version the drafts name before publishing either.
- **Workers Builds** (Cloudflare, not GitHub Actions) builds `site/` for the Worker `chaski`: a
  merge to `main` deploys chaski.sh, and every pull request gets a preview on workers.dev, linked
  in a comment. Its settings live in the Cloudflare dashboard: root directory `site`, build
  command `pnpm build`, deploy `npx wrangler deploy`, preview `npx wrangler preview`.

## Layout

- The repository root is the package published to npm as `chaskijs`; `site/` is the only other
  workspace member.
  tsdown bundles `src/index.ts` into `dist` and TypeScript emits the declarations next to it; only
  `dist` and `migrations/*.sql` ship, along with `README.md` and `LICENSE`. Hono is a peer
  dependency; React and the rest of the dashboard stack are dev dependencies, because they ship
  already built inside `dist`. So is `better-drizzle`, which tsdown bundles into `dist` (its peer
  range would make npm install a second `drizzle-orm`); keep it out of `dependencies`.
- Five entries, one per runtime: `chaskijs/worker` (the Chaski Worker), `chaskijs` (what the
  app's Worker imports: `userRoutes()`, the API's types and `type ChaskiEntrypoint`),
  `chaskijs/client` (the page), `chaskijs/sw` (the service worker) and `chaskijs/react` (hooks
  over the client). React is an optional peer dependency. Only `chaskijs/worker` may import the
  engine; `chaskijs` stays a few kilobytes, and no browser entry may import server code. The package also ships
  a `chaskijs` command for Node (`src/cli`): `chaskijs templates sql <file>` prints the SQL that
  applies a template file the way `templates.import()` does; `test/templates-sql.test.ts` holds
  the two to the same result.
- `src/contract` is what apps and clients see: the zod schemas and types of the API, the
  in-process API's interface, the errors and the template file format.
- `src/server` is the engine:
  - `api.ts` (the API), `entrypoint.ts` (`ChaskiEntrypoint`: that API over RPC, plus `fetch()`
    for the user routes and the pixel) and `config.ts` (the `CHASKI_*` bindings and vars, and the
    channel settings saved on the Channels page, validated on every call). A service binding sees
    methods, never getters, so over RPC the groups are methods: `feed()`, `push()`,
    `preferences()`, `schedules()`, `templates()`.
  - `routes/` holds the Hono sub-apps: the dashboard shell and assets and the admin API under
    `/api`, behind the Access guard in `index.ts`, and the open-tracking pixel and the user routes,
    which only `ChaskiEntrypoint.fetch()` serves. The user routes take the contact from
    `x-chaski-recipient`, which only the app's `userRoutes()` can set.
  - `services/` holds the business logic (`.agents/services.md`), with one adapter per
    channel in `services/adapters`.
  - `db/` holds the Drizzle schema and the better-drizzle client; `migrations.ts` refuses to run
    until every migration is applied, and its `ready()`, which every entry point awaits first,
    loads the channel settings (`services/settings.service.ts`) the config reads.
  - `consumer.ts` handles the queue batches, `durable/` holds the `ChaskiFeed` and `ChaskiEvents`
    Durable Objects and `workflows/` the `ChaskiScheduler` Workflow.
  - `auth.ts` keeps the `Actor` Access signed in, per request.
- `src/worker` is `chaskijs/worker`: the default export (the dashboard's `fetch` and the queue
  consumer) and the four classes a Chaski project's main module re-exports.
- `src/app` is the app side: `userRoutes()`, which identifies the signed-in contact with the app's
  own `identify` and forwards their requests over the service binding.
- `src/client`, `src/sw` and `src/react` are the browser entries; `src/react` builds its elements
  with `createElement`, so the package ships no JSX.
- `migrations/` holds the D1 migrations drizzle-kit generates; a Chaski project applies them from
  `node_modules/chaskijs/migrations`.
- `src/dashboard` is the dashboard (Vite root), React with TanStack Router and Query, shadcn
  (new-york, neutral) and lucide, dark and light. `vite.config.ts` embeds its build into
  `src/generated/dashboard.ts`, every chunk and the Latin subsets of Geist included.
  - `routes/` holds one page per screen, loaded on first visit; `components/app/` the dashboard's own
    pieces; `lib/` the admin API client and its response types, formats, the theme and the
    `/api/events` subscription that refetches what changed.
  - `components/ui/` comes from the shadcn registry as it ships, so updates stay reviewable: add a
    component with `node scripts/shadcn-add.ts <name>`. Biome relaxes a few rules for that folder
    only.
  - The shell's CSP allows no inline script and no inline style. Runtime styles take the per-load
    nonce the server writes into the shell (Radix reads it through `get-nonce`), chart colors go
    on the chart's `style`, and the email preview renders in an iframe the editor posts a form
    into, under the preview document's own sandboxed CSP.
- `brand/` holds the logo: the mark and the full logo (mark and wordmark, outlined), each in black
  (`#0A0A0A`) and white (`#FAFAFA`) ink. The README and the dashboard favicon use it; it doesn't
  ship in the package.
- `site/` is chaski.sh, the workspace package `chaski-site` with dependencies of its own: TanStack
  Start and Fumadocs, prerendered at build time and served as a Worker's static assets
  (`site/wrangler.jsonc` declares no Worker). `src/routes` holds the landing and the docs,
  `content/docs` the MDX pages and their order (`meta.json`), and `src/routeTree.gen.ts` is
  generated and committed. The build also writes `/llms.txt` from the docs and serves
  `skills/chaski` at `/skill/`, so the setup prompt can point agents at it. The pages hydrate from inline scripts, so `scripts/headers.ts` writes
  each page's Content-Security-Policy, with those scripts by hash, into `_headers` after the build.
  It doesn't ship in the package either.
- `skills/chaski` is the agent skill apps install with `npx skills add chrisllontop/chaski`:
  `SKILL.md` routes to `references/` (setup, browser clients, sending, the audit and its plan,
  troubleshooting), and `scripts/find-sends.mjs` lists the sends in a codebase for the audit. It
  quotes the config, the API and Chaski's error messages, so update it with them. It doesn't ship
  in the package.
- `test/fixture` is the Chaski Worker with every binding it uses (D1, queue and dead-letter queue,
  both Durable Objects, the Workflow, R2 and `send_email`) and a `CHASKI_SECRET` that is public
  and test-only, plus an app's `userRoutes()` under `/app/*`, which reach it through the loopback
  binding `exports.ChaskiEntrypoint`. The tests and `pnpm dev` both run it.

## Code conventions

Biome formats and lints: 2 spaces, single quotes, always semicolons, 100 columns. Run `pnpm lint`;
generated files (such as `routeTree.gen.ts`) are excluded in `biome.json`.

- Arrow functions (`const fn = () => {}`), not function declarations, in application code. The
  registry-managed shadcn files (`src/dashboard/components/ui/**`) keep their upstream
  declarations, so registry updates stay reviewable.
- Inferred types over annotations; no `any`.
- Use `~/` when a dashboard import crosses feature boundaries (`import { Button } from
  '~/components/ui/button'`). Relative imports are fine within one module tree, in
  registry-managed files and from root build or Worker entrypoints.
- Bindings reach code through `config.bindings`, never the env directly (see
  `.agents/services.md`), so tests can swap them.
- Each runtime has its own types: `tsconfig.json` (the Worker side of `src`, Workers types),
  `tsconfig.browser.json` (the browser entries and the contract, DOM types),
  `src/dashboard/tsconfig.json` (DOM and JSX), `test/tsconfig.json` (Workers plus the Vitest
  plugin), `test/browser/tsconfig.json` (the browser tests), `test/sw/tsconfig.json` (a real service
  worker scope against `chaskijs/sw`, WebWorker types), `test/node/tsconfig.json` (the tests of the
  skill's scripts, Node types), `site/tsconfig.json` (the site, DOM types),
  `site/tsconfig.node.json` (its config files and build script) and `tsconfig.node.json` (the config
  files, the scripts and the `chaskijs` command).
- tsdown bundles the JavaScript and TypeScript 7's compiler emits the declarations
  (`pnpm build:types`), so exported Drizzle tables and zod schemas keep their inferred types.
  `scripts/fix-declaration-imports.ts` then gives their relative imports the file extensions that
  Node16 and NodeNext resolution require.

### Comments

Comments say **why**: a non-obvious reason, an invariant, a workaround, a gotcha, a contract
another module relies on. A comment that repeats the name or the next lines goes.

- Leave a function, block or export that explains itself uncommented; prefer a clear name.
- Describe behavior in words, not by product screen or task numbers (`#10`, `#11`).
- Keep JSDoc (`/** */`) to about 3 lines. A longer block is for a non-obvious cross-module
  contract, invariant or workaround that would be unsafe to lose; reusable policy goes in a guide
  in `.agents/`.
- Section dividers (`// ─── … ───`) group unrelated blocks in large route or service files only.

## Tests

- Test logic and observable behavior. Do not assert markup or props.
- **Never wait with sleeps or arbitrary timeouts.** Use the test runner's own waiting, `vi.waitFor`
  or fake timers.
- Vitest runs three projects. `worker` runs inside workerd with `@cloudflare/vitest-plugin`, against
  the fixture Worker through `exports.default.fetch()` and `exports.ChaskiEntrypoint`: assert
  status, headers and JSON; the only markup a test reads is the injected `<base href>`. A request
  is signed in through Access only with the `MF-Access-Blob` header `signedIn()` from
  `test/helpers.ts` builds; `api()` sends it. `browser` runs `test/browser` in happy-dom,
  with a fake network and a fake socket (`test/browser/fakes.ts`) and fake timers for the
  reconnection logic; it also covers the dashboard's `lib/`. `node` runs `test/node` against the
  skill's scripts, on projects it writes to a temporary folder. The dashboard's screens have no
  tests: check them in `pnpm dev`.
- `test/setup.ts` applies the migrations, empties the tables and restores the fixture config before
  each test, and stubs the queue producer: tests drain deliveries with `processDeliveries()` from
  `test/helpers.ts`. Only the end-to-end test lets the real queue and consumer run.
- `useConfig()` overrides the config for one test, `stubEmail()` captures what the email binding
  would send, and `introspectWorkflow()` from `cloudflare:test` drives the scheduler without
  waiting. The fixture config turns email and in-app on from code; settings saved through the API
  replace it section by section, so a test of saved settings starts from
  `useConfig({ channels: {} })`, as a deployed Chaski does.
- No placeholder tests.

## Working agreements

- Commit small and often on your branch, following `.agents/git.md` (imperative, sentence
  case, no Conventional Commits prefixes). Run `pnpm check` and `pnpm build` before every push.
- Stay inside the files your task owns. If you need a change in a shared file (root config, guides,
  CI), make the smallest additive edit, or report it back.
- npm releases go through the Release workflow. Do not run `npm publish` yourself.
- This repository is public. Keep secrets, private project names and internal links out of code,
  commits, pull requests and docs.
- Never kill processes by pattern (`pkill -f`, `pgrep | kill`). Kill only a PID you started.
