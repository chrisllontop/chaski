## null vs undefined

`strict` is on, so `T | null` and `T | undefined` are distinct, non-interchangeable
types. The split of roles is intentional and layered — pick by **boundary and
meaning**, not by taste.

### Source of truth: the persistence layer emits `null`

A nullable column (e.g. a Drizzle column without `.notNull()`) infers as `T | null`.
SQLite has no `undefined`. Everything below is about what happens to that `null` as
it crosses a boundary in or out.

### Inputs (Zod request schemas)

- `.optional()` → `undefined` means **"leave unchanged"** (partial PATCH).
- `.nullable()` → `null` means **"clear this field"**. Use it only where a PATCH
  must be able to blank a value.
- Never use `.nullish()`.
- Canonical pattern for a clearable text field: a blank string becomes `null`
  (clear), `null` is accepted, an absent key stays `undefined` (leave unchanged).

### Service UPDATE methods

Mirror the input contract: skip `undefined`, write `null`.

```ts
if (input.x !== undefined) set.x = input.x ?? null;
```

### Output DTOs (mappers)

Optional scalar/date fields **always emit explicit `null`** — the key is always
present and the wire shape is stable (same as Stripe's real API). Do **not** use
`?? undefined` to drop a key from the JSON.

- A missing nested object / relation → `null` (`status ? {...} : null`).
- An embedded aggregate that defaults to a count → a numeric default (`?? 0`) is fine.
- Passthrough of a column that is already `T | null` is correct — it already emits `null`.
- Exceptions are allowed but must be deliberate (a business-meaningful fallback, or
  sanitizing an external source).

### Client

Client types are inferred from the API contract (`InferResponseType` from the RPC
client); unwrap optionals with `NonNullable<...>`. For a component's own props,
default to `prop?: T` (undefined); reserve `| null` for values that come straight
from an API resource.

### Quick reference

| Layer | Optional value is… |
|-------|--------------------|
| Persisted column | `T \| null` (automatic) |
| Zod input, "leave unchanged" | `.optional()` → `undefined` |
| Zod input, "clear it" | `.nullable()` → `null` |
| Service UPDATE | skip `undefined`, write `?? null` |
| Output DTO field | explicit `null` (key always present) |
| Missing relation / nested object | `null` |
| Component's own prop | `prop?: T` (`undefined`) |
