## Services

Business logic lives in services under `src/server/services/`, not in route handlers. Route handlers stay thin: parse and validate input, call a service, and shape the HTTP response. The API `ChaskiEntrypoint` serves (`src/server/api.ts`) calls the same services.

- Services extend `BaseService` (`src/server/services/base.service.ts`).
- All service methods are **static**: `TemplateService.get(id)`. No instance plumbing, no `db`, config or env passed as arguments. Never add singletons, `instance` getters, or constructors to a service.
- `BaseService` exposes static getters: `config` (the resolved config), `bindings` (the Worker's D1, queue, Durable Object and Workflow bindings), `client` (better-drizzle), `db` (raw Drizzle) and `log`.
- Only declare a local `const client = SomeService.client` when the function uses it more than once; for a single call, inline directly.
- One service per domain concept. Keep cross-cutting helpers in `src/server/lib/`.

```ts
export class TemplateService extends BaseService {
  static get = async (templateId: string) => {
    // config via TemplateService.config, persistence via TemplateService.client;
    // no Context, no passed db
  };
}
```

## Bindings come through the config

Chaski is its own Worker, and its wrangler.jsonc names every binding `CHASKI_*`. `src/server/config.ts` alone reads them from the env, into `config.bindings`, evaluated on every call; services go through `Service.bindings` and never read the env themselves, so a test can swap a binding. A binding may be missing: name it as wrangler.jsonc does (`bindingName()`) in the error.

## Channel settings come through the config too

Channels are set up on the dashboard and stored per section in the `settings` table, each section's one secret sealed with `CHASKI_SECRET` (`src/server/lib/sealed.ts`). `ready()` loads them on every request, and `Service.config` merges them over the env's config, so:

- Every entry point (a route, an RPC method, the queue batch, a Workflow step) awaits `ready()` before anything reads `Service.config`; reading it first throws instead of seeing no channels. `Service.bindings` and `Service.client` need no settings, which is how the open pixel skips the load.
- A saved section that stops validating never throws out of the config: its message goes into `config.problems`, its channel stays on, and its deliveries fail with it (see `errors.md`).
- Save a section through `SettingsService`, which validates it with the same resolvers as `validateConfig()` and reloads the settings in its isolate.

## Persistence

The database is **better-drizzle + Drizzle ORM + the Worker's Cloudflare D1** (`CHASKI_DB`):

- Any **schema or data-model change** ships a **generated migration** under `migrations/` (`drizzle-kit generate --name <name>`), and its file name goes into `MIGRATIONS` in `src/server/migrations.ts`. They go in with `wrangler d1 migrations apply`; Chaski refuses to run until every listed migration is applied.
- Use `SomeService.client` for ordinary reads/writes (`findMany`, `create`, `update`, `paginate`, `include`, `upsertMany`, `transaction`). Timestamps and soft delete are handled by plugins in `src/server/db/plugins/`.
- **When the client API is not enough:** use the raw Drizzle handle exposed by `BaseService.db` only for D1 `batch()`, conditional writes whose `meta.changes` is part of correctness, SQL aggregation, or an explicit retention/repair hard delete. Keep raw operations local and documented because they bypass Better Drizzle plugins.
- **Soft delete:** use `better-drizzle/soft-delete` only on recoverable business tables carrying nullable `deletedAt` (templates). Ordinary reads exclude tombstones; audit/recovery paths opt in with `deleted: 'with'` or `deleted: 'only'`; `delete()` is logical by default; and `mode: 'hard'` is restricted to explicit retention/repair purge paths. Device tokens, delivery rows and other operational data stay on hard deletion or their domain-specific terminal state.
- Schema lives in `src/server/db/schema/`. Derive types with `InferSelectModel<typeof table>` instead of hand-written interfaces where practical.
- **Timestamps:** persist absolute instants as UTC Unix epoch **milliseconds** in SQLite `INTEGER` columns declared through `timestamp()` / `timestampNow()` from `src/server/db/schema/timestamps.ts` (`mode: 'timestamp_ms'`). Better Drizzle and services read and write these values as `Date`; compare and index them numerically. Do not persist ISO date strings in domain timestamp columns.
- **Date handling:** keep persisted instants as `Date` inside services. Serialize public HTTP and SDK values as RFC 3339 UTC strings with millisecond precision (`toISOString()`), and accept external instants only with an explicit timezone before normalizing once. Epoch numbers are an internal database representation and must not leak through public contracts. Name instants `*At`; name durations with their unit (`*Ms`, `*Seconds`).
- **Idempotency:** dedupe rows with **unique indexes** (notifications and schedules by `idempotency_key`, deliveries by `(notification_id, channel)`). For one-shot side effects, claim atomically *before* running the effect and release the claim if it fails. When an insert can race a concurrent writer on a unique key, prefer one atomic upsert (`client.upsertMany` with `target`) over catch-and-retry on the constraint error.
- Keep query logic in services; do not duplicate it across routes.
