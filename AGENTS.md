# chaski

Embeddable notification infrastructure for Cloudflare Workers, dashboard included. A project mounts
chaski on a route of its own Worker, the way it would mount Swagger UI or Bull Board, and chaski runs
on that project's Cloudflare resources: email, web push and in-app notifications, with templates,
scheduling, retries and a dashboard. Open source (MIT), published on npm as `chaski`.

**Current stage: repository base, no engine code yet.** Tooling, conventions, CI and docs are in
place, and the package builds an empty entry point.

## Run it

- `pnpm i` installs the dependencies (Node 24 and pnpm 12). `devEngines` holds contributors to
  Node 24 without putting that constraint on the people who install `chaski`.
- `pnpm typecheck` (tsc), `pnpm lint` (Biome), `pnpm format` (Biome with fixes), `pnpm test`
  (Vitest), `pnpm build` (tsdown).
- `pnpm check` runs typecheck, lint and test, the same gate CI runs before the build.

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
  tsdown builds `src/index.ts` into `dist` (ESM plus declarations); only `dist` ships, along with
  `README.md` and `LICENSE`.
- The dashboard is expected at `src/dashboard`, where `copy.mdc` already points.

## Code conventions

The rules live in `.cursor/rules/`: `git.mdc` (commit and pull request conventions), `style.mdc`
(code style), `types.mdc` (null vs undefined across layers) and `copy.mdc` (voice, terminology and
punctuation for user-facing text). Read them before committing, writing code or writing copy. Rules
for the API, services, database, errors and UI arrive with the code they govern.

- Biome: 2 spaces, single quotes, semicolons, 100 columns. Run `pnpm lint`.
- Arrow functions, not function declarations. Inferred types over annotations, except on exports
  (see `isolatedDeclarations` below); no `any`.
- Comments say **why** (a constraint, an invariant, a quirk), never what the next line does.
- chaski runs inside the host's Worker and only on the bindings the host declares. Do not assume
  binding names or reach for resources the host did not hand over.
- TypeScript 7 has no classic compiler API, so tsdown emits declarations with Oxc, which needs
  `isolatedDeclarations`: an export whose type can't be read from its own syntax needs an explicit
  annotation. `pnpm typecheck` reports a missing one (TS9007, TS9010, TS9013), and so does
  `pnpm build`. tsdown's tsgo generator would lift that rule; it needs TypeScript 7.1, in beta as of
  October 2026.

## Tests

- Test logic and observable behavior. Do not assert markup or props.
- **Never wait with sleeps or arbitrary timeouts.** Use the test runner's own waiting, `vi.waitFor`
  or fake timers.
- No placeholder tests. Vitest passes with no test files until there is code to test.

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
