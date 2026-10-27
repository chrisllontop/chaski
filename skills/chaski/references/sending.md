# Send with Chaski

What the host’s code calls once Chaski is set up. The full guides: https://chaski.sh/docs/sending,
https://chaski.sh/docs/scheduling, https://chaski.sh/docs/templates and
https://chaski.sh/docs/preferences. Every request and result type is in
`node_modules/chaskijs/dist/contract/contract.d.ts`.

## Types and templates

Every notification has a **type**: letters, digits, `_`, `.` and `-`, such as `payment_received`
or `billing.invoice_due`. A send of a type without a template fails with a `validation` error
that names the type, so the template comes first.

A template holds, per channel, three fields under the same three names:

| Channel | `subject` | `body` | `textBody` |
| --- | --- | --- | --- |
| `email` | Subject | HTML body | Plain-text body (optional) |
| `in_app` | Title | Message | Link the item opens (optional) |
| `push` | Title | Message | Link the notification opens (optional) |

A channel goes out only when the template has it `enabled`. A template can also carry a
`description`, a `topic` that groups it on the user’s preferences screen, and `sampleData`, a
string of JSON the dashboard previews it with.

Templates live in Chaski’s database: the user writes them in the dashboard under **Templates**,
**New template**, with a live preview. A project can also keep them in its repository as the file
the dashboard exports, and load it from a seed route, its tests or another Worker with
`chaski.templates.import(file)` (`{ preview: true }` reports without applying; over RPC,
`env.CHASKI.templates().import(file)`). Otherwise, when a template comes from code, hand the user
its fields to paste, channel by channel:

```text
Type         payment_received
Topic        billing
Sample data  {"amount": "$15.00", "recipient": {"name": "Ana"}}

email    subject   We received {{ amount }}
         body      <p>Thanks, {{ recipient.name }}. We received {{ amount }}.</p>
         textBody  Thanks, {{ recipient.name }}. We received {{ amount }}.
in_app   subject   Payment received
         body      We received {{ amount }}.
         textBody  /payments
```

### Liquid

Templates are [Liquid](https://liquidjs.com). They see the send’s `payload` at the top level, plus
`recipient` (`id`, and `email`, `name`, `phone`, `timezone`, `locale` when the send gave them).

- A missing key renders empty instead of failing the delivery.
- An email `body` escapes every value for HTML on its own. A value that holds HTML on purpose
  goes through `raw`: `{{ summary_html | raw }}`. The subject, the text body, in-app and push
  are plain text and stay as written.
- Loops and conditions: `{% for item in items %}…{% endfor %}`, `{% if overdue %}…{% endif %}`.
  Only `nil` and `false` are false: test a list with `{% if items.size > 0 %}` and a string with
  `{% if name != blank %}`.
- Liquid that doesn’t parse is rejected when the template is saved, and fails its delivery at once
  instead of retrying.

## Send

```ts
import { chaski } from './chaski';

const result = await chaski.send({
  type: 'payment_received',
  recipient: { id: user.id, email: user.email, name: user.name },
  payload: { amount: '$15.00' },
  idempotencyKey: `payment_received:${payment.id}`,
});
```

| Field | |
| --- | --- |
| `type` | Picks the template. |
| `recipient` | `id` is required: the same id `identify` returns in the user routes, so the feed and preferences line up. `email` is needed for the email channel. |
| `payload` | The values the template renders with. |
| `channels` | Narrows the send to some of the template’s channels, such as `['email']`. A channel the config doesn’t turn on fails the send. |
| `transactional` | `true` sends whatever the contact’s preferences say: receipts, password resets, security alerts. |
| `email` | `fromName`, `replyTo`, and up to 10 `attachments` (`filename`, `contentType`, and base64 `content` or a `url`); attachments need the R2 binding. |
| `idempotencyKey` | The same key returns the first send’s result (`replayed: true`) instead of sending again. |
| `inline` | `true` delivers the email before `send()` returns, for someone waiting on it; needs `transactional: true` and `channels: ['email']`. |

Derive the idempotency key from the event the notification is about, such as the payment or the
order, so a retried request or a redelivered queue message sends once.

`send()` records the notification and puts one delivery per channel on the queue; it doesn’t wait
for providers, except with `inline` (below). It returns
`{ notificationId, replayed, outcome, deliveries }`:

- `outcome: 'delivered'`: at least one channel took it.
- `outcome: 'suppressed'`: the contact’s preferences skipped every channel.
- `outcome: 'undeliverable'`: the config or the contact’s data skipped every channel.

A skipped delivery carries a `reason`: `channel_not_configured`, `muted_by_preferences`,
`missing_email`, `no_device_tokens` or `no_template`.

### Inline, for someone waiting

A password reset, a verification or a sign-in link has a person on screen waiting for the email.
Send those with `inline: true`, `transactional: true` and `channels: ['email']`: Chaski delivers
the email before `send()` returns and throws `ChaskiError` with the code `delivery_failed` when the
provider doesn’t take it, so the route answers the person with an error instead of a silent
success. The delivery is recorded and shows in the dashboard as usual; a failed one isn’t retried
in the background. With an `idempotencyKey`, a second request tries a failed email again and
returns one that went out as it was. Everything else (receipts, digests, reminders) stays on the
queue, which retries with backoff.

## Schedule

```ts
await chaski.schedule({
  type: 'invoice_due',
  recipient: { id: user.id, email: user.email },
  payload: { invoice: 'INV-1042' },
  scheduledAt: '2026-11-01T09:00:00-05:00',
  idempotencyKey: 'invoice_due:INV-1042',
  groupKey: `trial:${trial.id}`, // optional, to cancel several at once
});

await chaski.schedules.cancel({ idempotencyKey: 'invoice_due:INV-1042' });
await chaski.schedules.cancel({ groupKey: `trial:${trial.id}` });
const pending = await chaski.schedules.list({ recipientId: user.id });
```

- `scheduledAt` is ISO 8601 with an explicit offset (`Z` or `±hh:mm`); a time in the past is
  rejected, with five minutes of grace.
- Scheduling again with the same `idempotencyKey` moves the pending send instead of adding one, so
  derive the key from what the notification is about, never from the time. The result’s `op` says
  what happened: `created`, `updated`, `completed` (it already went out, and nothing changed) or
  `cancelled` (the new time had passed). Something that arms again after it fired needs a new key
  each time.
- Preferences and the template are read when the send fires, not when it’s scheduled.
- A schedule is one send at one time. Something that repeats, such as a weekly digest, stays a
  Cron Trigger in the host whose handler calls `chaski.send()`.
- It needs the `ChaskiScheduler` Workflow bound as `scheduler`.

## Preferences

A contact’s preferences are channels they turned off and types they muted:

```ts
await chaski.preferences.set(user.id, {
  channels: { email: false },        // merges key by key
  mutedTypes: ['marketing.*', 'push:reminder.*'], // overwrites the whole list
});
const { channels, mutedTypes } = await chaski.preferences.get(user.id);
const topics = await chaski.preferences.topics(); // types grouped by their template's topic
```

- A `mutedTypes` entry ending in `*` mutes every type starting with it; a `channel:` prefix limits
  it to that channel.
- `mutedTypes` overwrites the stored list on every `set`: send the full list.
- `defaultMutedTypes` in the config mutes types for every contact until they save preferences of
  their own, for opt-in types such as a digest. `get()` for a contact who never saved returns
  those defaults, with every channel on.
- Every send checks preferences channel by channel, except `transactional: true` sends.

## Feed and devices on the server

```ts
await chaski.feed.list({ recipientId: user.id, limit: 20 });    // { items, nextCursor }
await chaski.feed.unreadCount(user.id);                         // { unread }
await chaski.feed.markRead({ recipientId: user.id, ids: [id] }); // or before, or neither for all

await chaski.push.register({ recipient: { id: user.id }, platform: 'ios', deviceToken });
await chaski.push.register({ recipient: { id: user.id }, subscription }); // a web push subscription
await chaski.push.unregister({ deviceToken });
```

Registering an endpoint or a device token Chaski already knows hands it to this contact, so a
repeat is safe.

The frontend reaches the same data as the signed-in user through `chaski.userRoutes()`; see
[browser-clients.md](browser-clients.md).

## Errors

Chaski throws `ChaskiError` with a `code`: `validation` (fix the request or the template),
`config` (fix the setup), `delivery_failed` (an inline email didn’t go out), `not_found`,
`conflict`, `unauthorized`, `forbidden`, `internal`. Check
it with `isChaskiError(error)`, never `instanceof`, since the class doesn’t survive a service
binding or a queue. `isRetryableChaskiError(error)` is `true` only for `internal` and for errors
that aren’t Chaski’s.
