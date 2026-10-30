## Route layout

- The admin API lives in `src/server/routes/`, at `/api/*` on the Chaski Worker's own URL, behind Cloudflare Access with the dashboard. One router per concern; `src/server/routes/index.ts` composes them.
- It is **not versioned**: its only consumer is Chaski's own dashboard, which ships in the same package. Apps integrate through `ChaskiEntrypoint` over a service binding (`env.CHASKI.send()`, `env.CHASKI.feed()`…), not over HTTP.
- The dashboard assets are registered before the Access guard and stay outside `/api/*`. The open-tracking pixel and the user routes are not on the Worker's URL at all: `ChaskiEntrypoint.fetch()` serves them, and the app's `userRoutes()` forwards them over its service binding.

## Request validation

- Request schemas (zod) are defined **inline in the route file** that uses them; colocation is the default.
- Move a schema to `src/contract/` only when it is genuinely shared: by the in-process API, the browser clients or a service.
- Validate with `parseBody(schema, value)`, which throws a `validation` error with the issues joined into the message.

## Error responses

Every JSON error is `{ error: code, message }`, where `code` is a `ChaskiErrorCode` (`validation`, `config`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `internal`). Services throw `ChaskiError(code, message)`; each Hono app's `onError` maps the code to the status (400, 500, 401, 403, 404, 409, 500). Clients switch on `code`, never on `message`. Do not invent parallel error shapes.

## Success responses

- A single resource or a full list goes under a named key: `{ template }`, `{ templates }`, `{ counts }`.
- Paginated lists return `{ rows, total, page, limit }` with offset pagination (`page` is zero-based).
- Deletions return the stub `{ id, deleted: true }` instead of an empty body.
- Mutations that only trigger work return what happened: `{ requeued: true }`, `{ requeued: 12 }`.
- Instants are RFC 3339 UTC strings (see `services.md`).

## Resource IDs

Persisted resources use prefixed random ids from `newId(prefix)` (`src/server/lib/ids.ts`): `n_` notifications, `d_` deliveries, `f_` feed items, `s_` schedules, `tpl_` templates, `tc_` template channels, `dt_` device tokens. The prefix makes an id's kind obvious in logs and support threads; the random part (16 characters of CSPRNG output) is the capability, so never shorten it.
