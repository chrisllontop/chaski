# chaski

Embeddable notification infrastructure for Cloudflare Workers, dashboard included. A project mounts
chaski on a route of its own Worker, the way it would mount Swagger UI or Bull Board, and chaski runs
on that project's Cloudflare resources: email, web push and in-app notifications, with templates,
scheduling, retries and a dashboard. Open source (MIT), published on npm as `chaski`.

**Current stage: the engine, without browser clients or dashboard screens.** `createChaski()` takes
the host's config; chaski sends email, web push, APNs and in-app notifications through the host's
queue, with templates, preferences, scheduled sends, retries and realtime events. `chaski.routes()`
mounts the dashboard shell and the admin API, and `chaski.userRoutes()` the endpoints the host's
frontend calls for the signed-in user. The browser clients (`chaski/client`, `chaski/sw`,
`chaski/react`) and the dashboard screens come next.

## Run it

- `pnpm i` installs the dependencies (Node 24 and pnpm 12). `devEngines` holds contributors to
  Node 24 without putting that constraint on the people who install `chaski`.
- `pnpm dev` builds the dashboard and runs the fixture host (`test/fixture`) with Wrangler, in
  dry run so no email or push leaves the machine. It mounts the dashboard at `/chaski` and
  `/admin/notifications` and the user routes at `/me/notifications`; there is no hot reload, so
  rerun it after a dashboard change. Apply the migrations to the local D1 first:
  `pnpm wrangler d1 migrations apply CHASKI_DB --local -c test/fixture/wrangler.jsonc`.
- `pnpm build:dashboard` (Vite) writes `src/generated/dashboard.ts`, which the server code imports.
  It is generated and gitignored; run it once before typechecking or testing on a fresh clone.
- `pnpm typecheck` (tsc, four projects), `pnpm lint` (Biome), `pnpm format` (Biome with fixes),
  `pnpm test` (Vitest in workerd), `pnpm build` (dashboard, tsdown, then the declarations).
- `pnpm drizzle-kit generate --name <name>` writes a migration into `migrations/` after a schema
  change; `.cursor/rules/database.mdc` says what else a migration needs.
- `pnpm check` builds the dashboard, then runs typecheck, lint and test: the same gate CI runs before
  the build.

## CI

- **Verify** (`.github/workflows/pull-request.yml`) runs on every pull request: `pnpm check` and
  `pnpm build` on Linux.
- **Release Drafter** keeps a draft release from merged pull requests (labels `breaking`,
  `feature`/`enhancement` pick the version bump; patch is the default). `v0.0.1` is the baseline.
- **Release** runs when a `v*` release is published: it checks that the tag matches
  `package.json`'s version and is on `main`, builds the package and publishes it to npm with
  trusted publishing (OIDC, no token). Bump the package version before publishing.

## Layout

- One package, no workspace: the repository root is the package published to npm as `chaski`.
  tsdown bundles `src/index.ts` into `dist` and TypeScript emits the declarations next to it; only
  `dist` and `migrations/*.sql` ship, along with `README.md` and `LICENSE`. Hono is a peer
  dependency; React and the rest of the dashboard stack are dev dependencies, because they ship
  already built inside `dist`.
- `src/contract` is what hosts and clients see: the zod schemas and types of the API, the
  in-process API's interface, the errors and the template file format.
- `src/server` is the engine:
  - `chaski.ts` (`createChaski()` and the in-process API) and `config.ts` (the host's config,
    validated on every call).
  - `routes/` holds the Hono sub-apps: the dashboard shell and assets, the admin API under `/api`,
    the open-tracking pixel and the user routes.
  - `services/` holds the business logic (`.cursor/rules/services.mdc`), with one adapter per
    channel in `services/adapters`.
  - `db/` holds the Drizzle schema and the better-drizzle client; `migrations.ts` refuses to run
    until the host applied every migration.
  - `consumer.ts` handles the queue batches, `durable/` holds the `ChaskiFeed` and `ChaskiEvents`
    Durable Objects and `workflows/` the `ChaskiScheduler` Workflow. The host re-exports all three
    from its main module.
  - `auth.ts` defines `Actor`, `Authorize` and the `cloudflareAccess()` and `basicAuth()` helpers.
- `migrations/` holds the D1 migrations drizzle-kit generates; hosts apply them from
  `node_modules/chaski/migrations`.
- `src/dashboard` is the dashboard (Vite root). `vite.config.ts` embeds its build into
  `src/generated/dashboard.ts`.
- `test/fixture` is a host Worker that mounts chaski and declares every binding it uses (D1, queue
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
- chaski runs inside the host's Worker and only on the bindings the host declares. Do not assume
  binding names or reach for resources the host did not hand over.
- Each runtime has its own types: `tsconfig.json` (the Worker side of `src`, Workers types),
  `src/dashboard/tsconfig.json` (DOM and JSX), `test/tsconfig.json` (Workers plus the Vitest
  plugin) and `tsconfig.node.json` (the config files).
- tsdown bundles the JavaScript and TypeScript 7's compiler emits the declarations
  (`pnpm build:types`), so exported Drizzle tables and zod schemas keep their inferred types.
  `scripts/fix-declaration-imports.ts` then gives their relative imports the file extensions that
  Node16 and NodeNext resolution require.

## Tests

- Test logic and observable behavior. Do not assert markup or props.
- **Never wait with sleeps or arbitrary timeouts.** Use the test runner's own waiting, `vi.waitFor`
  or fake timers.
- Tests run inside workerd with `@cloudflare/vitest-plugin`, against the fixture host through
  `exports.default.fetch()`. Assert status, headers and JSON; the only markup a test reads is the
  injected `<base href>`.
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
