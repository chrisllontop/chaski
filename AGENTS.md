# Chaski

Embeddable notification infrastructure for Cloudflare Workers, dashboard included. A project mounts
Chaski on a route of its own Worker, and Chaski runs on that project's Cloudflare resources: email,
web push and in-app notifications, with templates, scheduling, retries and a dashboard. Open source
(MIT), published on npm as `chaski`.

**Current stage: the engine, the browser clients, the dashboard and the setup guide in the README.**
`createChaski()` takes the host's config; Chaski sends email, web push, APNs and in-app
notifications through the host's queue, with templates, preferences, scheduled sends, retries and
realtime events. `chaski.routes()` mounts the dashboard and its admin API, and `chaski.userRoutes()`
the endpoints the host's frontend calls for the signed-in user, which `chaski/client`, `chaski/sw`
and `chaski/react` wrap for the page, the service worker and React. `ChaskiEntrypoint` serves the
same in-process API over RPC to the host's other Workers.

## Run it

- `pnpm i` installs the dependencies (Node 24 and pnpm 12). `devEngines` holds contributors to
  Node 24 without putting that constraint on the people who install `chaski`.
- `pnpm dev` builds the dashboard and runs the fixture host (`test/fixture`) with Wrangler, in
  dry run so no email or push leaves the machine. It mounts the dashboard at `/chaski` and
  `/admin/notifications` and the user routes at `/me/notifications`; there is no hot reload, so
  rerun it after a dashboard change. Apply the migrations to the local D1 first:
  `pnpm wrangler d1 migrations apply CHASKI_DB --local -c test/fixture/wrangler.jsonc`.
  `curl -X POST localhost:8787/dev/seed` then fills it with sample templates, sends and schedules
  (`test/fixture/seed.ts`), so the dashboard has something to show.
- `pnpm build:dashboard` (Vite) writes `src/generated/dashboard.ts`, which the server code imports.
  It is generated and gitignored; run it once before typechecking or testing on a fresh clone.
- `pnpm typecheck` (tsc, nine projects), `pnpm lint` (Biome), `pnpm format` (Biome with fixes),
  `pnpm test` (Vitest in workerd), `pnpm build` (dashboard, tsdown, then the declarations).
- `pnpm dev:site` serves chaski.sh, landing and docs, with Vite. `pnpm build:site` prerenders every
  page to `site/dist/client` and writes their headers; `pnpm --filter chaski-site preview` serves
  that build as production does. Workers Builds publishes it (see CI); `pnpm deploy:site` is the
  manual fallback, and only the owner runs it.
- `pnpm drizzle-kit generate --name <name>` writes a migration into `migrations/` after a schema
  change; `.cursor/rules/database.mdc` says what else a migration needs.
- `pnpm check` builds the dashboard, then runs typecheck, lint and test, and builds the site: the
  same gate CI runs before the build.

## CI

- **Verify** (`.github/workflows/pull-request.yml`) runs on every pull request: `pnpm check` and
  `pnpm build` on Linux.
- **Release Drafter** keeps a draft release from merged pull requests (labels `breaking`,
  `feature`/`enhancement` pick the version bump; patch is the default). `v0.0.1` is the baseline.
- **Release** runs when a `v*` release is published: it checks that the tag matches
  `package.json`'s version and is on `main`, builds the package and publishes it to npm with
  trusted publishing (OIDC, no token). Bump the package version before publishing.
- **Workers Builds** (Cloudflare, not GitHub Actions) builds `site/` for the Worker `chaski`: a
  merge to `main` deploys chaski.sh, and every pull request gets a preview on workers.dev, linked
  in a comment. Its settings live in the Cloudflare dashboard: root directory `site`, build
  command `pnpm build`, deploy `npx wrangler deploy`, preview `npx wrangler preview`.

## Layout

- The repository root is the package published to npm as `chaski`; `site/` is the only other
  workspace member.
  tsdown bundles `src/index.ts` into `dist` and TypeScript emits the declarations next to it; only
  `dist` and `migrations/*.sql` ship, along with `README.md` and `LICENSE`. Hono is a peer
  dependency; React and the rest of the dashboard stack are dev dependencies, because they ship
  already built inside `dist`.
- Four entries, one per runtime: `chaski` (the Worker), `chaski/client` (the page), `chaski/sw`
  (the service worker) and `chaski/react` (hooks over the client). React is an optional peer
  dependency, and no browser entry may import server code.
- `src/contract` is what hosts and clients see: the zod schemas and types of the API, the
  in-process API's interface, the errors and the template file format.
- `src/server` is the engine:
  - `chaski.ts` (`createChaski()`), `api.ts` (the in-process API), `entrypoint.ts`
    (`ChaskiEntrypoint`, that API over RPC) and `config.ts` (the host's config, validated on every
    call). A service binding sees methods, never getters, so over RPC the groups are methods:
    `feed()`, `push()`, `preferences()`, `schedules()`.
  - `routes/` holds the Hono sub-apps: the dashboard shell and assets, the admin API under `/api`,
    the open-tracking pixel and the user routes.
  - `services/` holds the business logic (`.cursor/rules/services.mdc`), with one adapter per
    channel in `services/adapters`.
  - `db/` holds the Drizzle schema and the better-drizzle client; `migrations.ts` refuses to run
    until the host applied every migration.
  - `consumer.ts` handles the queue batches, `durable/` holds the `ChaskiFeed` and `ChaskiEvents`
    Durable Objects and `workflows/` the `ChaskiScheduler` Workflow. The host re-exports all three
    from its main module, plus `ChaskiEntrypoint` when its other Workers call Chaski.
  - `auth.ts` defines `Actor`, `Authorize` and the `cloudflareAccess()` and `basicAuth()` helpers.
- `src/client`, `src/sw` and `src/react` are the browser entries; `src/react` builds its elements
  with `createElement`, so the package ships no JSX.
- `migrations/` holds the D1 migrations drizzle-kit generates; hosts apply them from
  `node_modules/chaski/migrations`.
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
  generated and committed. The pages hydrate from inline scripts, so `scripts/headers.ts` writes
  each page's Content-Security-Policy, with those scripts by hash, into `_headers` after the build.
  It doesn't ship in the package either.
- `test/fixture` is a host Worker that mounts Chaski and declares every binding it uses (D1, queue
  and dead-letter queue, both Durable Objects, the Workflow, R2 and `send_email`); the tests and
  `pnpm dev` both run it.

## Code conventions

The rules live in `.cursor/rules/`: `git.mdc` (commit and pull request conventions), `style.mdc`
(code style), `types.mdc` (null vs undefined across layers), `copy.mdc` (voice, terminology and
punctuation for user-facing text), `api.mdc` (routes and responses), `services.mdc` (services and
persistence), `database.mdc` (schema and migrations) and `errors.mdc` (errors and their codes).
Read the ones that apply before committing, writing code or writing copy. Rules for the UI arrive
with the code they govern.

- Biome: 2 spaces, single quotes, semicolons, 100 columns. Run `pnpm lint`.
- Arrow functions, not function declarations. Inferred types over annotations; no `any`.
- Comments say **why** (a constraint, an invariant, a quirk), never what the next line does.
- Chaski runs inside the host's Worker and only on the bindings the host declares. Do not assume
  binding names or reach for resources the host did not hand over.
- Each runtime has its own types: `tsconfig.json` (the Worker side of `src`, Workers types),
  `tsconfig.browser.json` (the browser entries and the contract, DOM types),
  `src/dashboard/tsconfig.json` (DOM and JSX), `test/tsconfig.json` (Workers plus the Vitest
  plugin), `test/browser/tsconfig.json` (the browser tests), `test/sw/tsconfig.json` (a real service
  worker scope against `chaski/sw`, WebWorker types), `site/tsconfig.json` (the site, DOM types),
  `site/tsconfig.node.json` (its config files and build script) and `tsconfig.node.json` (the config
  files and scripts).
- tsdown bundles the JavaScript and TypeScript 7's compiler emits the declarations
  (`pnpm build:types`), so exported Drizzle tables and zod schemas keep their inferred types.
  `scripts/fix-declaration-imports.ts` then gives their relative imports the file extensions that
  Node16 and NodeNext resolution require.

## Tests

- Test logic and observable behavior. Do not assert markup or props.
- **Never wait with sleeps or arbitrary timeouts.** Use the test runner's own waiting, `vi.waitFor`
  or fake timers.
- Vitest runs two projects. `worker` runs inside workerd with `@cloudflare/vitest-plugin`, against
  the fixture host through `exports.default.fetch()`: assert status, headers and JSON; the only
  markup a test reads is the injected `<base href>`. `browser` runs `test/browser` in happy-dom,
  with a fake network and a fake socket (`test/browser/fakes.ts`) and fake timers for the
  reconnection logic; it also covers the dashboard's `lib/`. The dashboard's screens have no tests:
  check them in `pnpm dev`.
- `test/setup.ts` applies the migrations, empties the tables and restores the fixture config before
  each test, and stubs the queue producer: tests drain deliveries with `processDeliveries()` from
  `test/helpers.ts`. Only the end-to-end test lets the real queue and consumer run.
- `useConfig()` overrides the config for one test, `stubEmail()` captures what the email binding
  would send, and `introspectWorkflow()` from `cloudflare:test` drives the scheduler without
  waiting.
- No placeholder tests.

## Working agreements

- Commit small and often on your branch, following `.cursor/rules/git.mdc` (imperative, sentence
  case, no Conventional Commits prefixes). Run `pnpm check` and `pnpm build` before every push.
  **Do not push and do not open pull requests unless asked.**
- Stay inside the files your task owns. If you need a change in a shared file (root config, rules,
  CI), make the smallest additive edit, or report it back.
- npm releases go through the Release workflow. Do not run `npm publish` yourself.
- This repository is public. Keep secrets, private project names and internal links out of code,
  commits, pull requests and docs.
- Never kill processes by pattern (`pkill -f`, `pgrep | kill`). Kill only a PID you started.
