# Send with Chaski

What the app’s code calls through its `CHASKI` binding once Chaski is set up
([setup.md](setup.md)). The examples write `env.CHASKI`; in a Hono handler it’s `c.env.CHASKI`.
The full guides: https://chaski.sh/docs/sending, https://chaski.sh/docs/scheduling,
https://chaski.sh/docs/templates and https://chaski.sh/docs/preferences. Every request and result
type is in `node_modules/chaskijs/dist/contract/contract.d.ts`.

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

A channel goes out only when the template has it `enabled` and the channel is on (its settings
saved on the dashboard’s **Channels** page). A template can also carry a `description`, a `topic`
that groups it on the user’s preferences screen, and `sampleData`, a string of JSON the dashboard
previews it with. Each channel can carry the same three fields in other languages, its
**translations** (below).

### The template file

Templates live in Chaski’s database and reach it from a **template file**:
`chaski-templates.json` at the root of the Chaski project, one entry per type. Write the
templates there, load the file, and have the user check each one under **Templates** in the
dashboard, whose preview renders it with its `sampleData`.

```json title="chaski-templates.json"
{
  "format": "chaski.templates",
  "version": 2,
  "defaultLocale": "en",
  "templates": [
    {
      "type": "payment_received",
      "topic": "billing",
      "sampleData": "{\"amount\": 15, \"recipient\": {\"name\": \"Ana\"}}",
      "channels": [
        {
          "channel": "email",
          "enabled": true,
          "subject": "We received {{ amount | currency: 'USD' }}",
          "body": "<p>Thanks, {{ recipient.name }}. We received {{ amount | currency: 'USD' }}.</p>",
          "textBody": "Thanks, {{ recipient.name }}. We received {{ amount | currency: 'USD' }}.",
          "translations": {
            "es": {
              "subject": "Recibimos {{ amount | currency: 'USD' }}",
              "body": "<p>Gracias, {{ recipient.name }}. Recibimos {{ amount | currency: 'USD' }}.</p>",
              "textBody": "Gracias, {{ recipient.name }}. Recibimos {{ amount | currency: 'USD' }}."
            }
          }
        },
        {
          "channel": "in_app",
          "enabled": true,
          "subject": "Payment received",
          "body": "We received {{ amount | currency: 'USD' }}.",
          "textBody": "/payments"
        }
      ]
    }
  ]
}
```

A file that sends in one language leaves out `defaultLocale` and `translations`. A file of
`"version": 1`, the format before translations, still loads, and one that carries `translations`
is refused rather than loaded without them.

Load it into the local database from the Chaski project, after Chaski’s migrations:

```sh
npx chaskijs templates sql chaski-templates.json > .wrangler/chaski-templates.sql
npx wrangler d1 execute CHASKI_DB --local --file .wrangler/chaski-templates.sql
```

- **Loaded** when both commands exit 0 and **Templates** lists every type in the file (a dashboard
  already open shows them once reloaded). `chaskijs templates sql` stops at a file it can’t load
  (Liquid that doesn’t parse, a type listed twice) and names the type, channel and field; fix the
  file and run both again.
- **Loading again** changes nothing for the types that match. A type that differs takes the
  file’s fields, overwriting what the user edited in the dashboard. Once the user edits there,
  bring the file up to date from `env.CHASKI.templates().export()`, or load a file with only the
  new types.
- **Production** runs the same two commands with `--remote` in place of `--local`, after
  `wrangler d1 migrations apply CHASKI_DB --remote`, and another environment adds `--env <name>`.
  They write to the user’s database: ask first.
- **From the app’s code**, `env.CHASKI.templates().import(file)` applies the same file (a seed
  route, a deploy job), and `{ preview: true }` reports what it would change without writing.
- **Translations need the Worker’s languages.** A file with `translations` loads only into a
  Chaski whose languages are saved on **Channels**, **Languages**, with the file’s
  `defaultLocale` as the default: the user saves them there first, in each environment. Without
  them, or with another default, nothing loads: the SQL stops at `this file has its default
  content in en`, and `import()` names both languages.

### Languages

A Chaski sends in a **default language**, the one every template’s content is written in, and in
the other languages saved under **Languages** on **Channels**. With none saved, every send renders
the default content.

- **The content per language.** A channel’s `translations` hold its `subject`, `body` and
  `textBody` in each other language, keyed by BCP 47 tag (`es`, `pt-BR`). Every field is the
  translation’s own: one it leaves out is empty, never the default’s. It needs a `body`, and it
  can’t be in the default language.
- **The language a send asks for** is its own `locale`, for that send alone, or else
  `recipient.locale`. Chaski reads either as Intl does (`es-pe` and `es_PE` are `es-PE`); a value
  that isn’t a language tag counts as absent, so the send goes out in the default language.
- **Each channel picks on its own**: the translation in that locale, else in its language (`es`
  for `es-PE`), else the default content, among the Worker’s languages only. So a send can email
  in Spanish while its in-app item falls back to English, when only the email is translated.
- **Outdated.** A translation remembers the default content it was written from. Once that
  content changes, the dashboard marks the translation outdated until someone saves it again or
  marks it current; it still goes out meanwhile. An exported file writes `"outdated": true` on it,
  and the import keeps it so.
- **Every delivery records** the language it went out in, which the dashboard’s **Deliveries**
  shows next to the one the send asked for, and the **Overview** counts the deliveries that went
  out in another language than asked for.

### Liquid

Templates are [Liquid](https://liquidjs.com). They see the send’s `payload` at the top level, plus
`recipient` (`id`, and `email`, `name`, `phone`, `timezone`, `locale` when the send gave them) and,
once the Worker has languages, `locale`: the language the channel renders in.

- Three filters format for the reader, in the language the content renders in, with the region the
  send asked for when it is that language (`es-PE` over Spanish content):
  `{{ count | number }}` (`{{ ratio | number: 2 }}` for two decimals),
  `{{ amount | currency: 'USD' }}`, and `{{ paidAt | format_date }}`, a date in the long style,
  with `format_date: 'medium', 'short'` for the date and the time, or `'none', 'short'` for the
  time alone. Dates are in `recipient.timezone`, or UTC without one; a number or a string of
  digits counts seconds, as Liquid’s `date` does. A value they can’t read prints as it came. With
  no languages saved, they format in English.

- A missing key renders empty instead of failing the delivery.
- An email `body` escapes every value for HTML on its own. A value that holds HTML on purpose
  goes through `raw`: `{{ summary_html | raw }}`. The subject, the text body, in-app and push
  are plain text and stay as written, HTML entities included: `&middot;` reaches the inbox as
  typed. Write the characters themselves: `chaskijs templates sql` prints a warning for each
  entity left, and `templates().import()` lists them under `warnings`.
- Loops and conditions: `{% for item in items %}…{% endfor %}`, `{% if overdue %}…{% endif %}`.
  Only `nil` and `false` are false: test a list with `{% if items.size > 0 %}` and a string with
  `{% if name != blank %}`.
- Liquid that doesn’t parse is rejected when the template is saved or loaded, and fails its
  delivery at once instead of retrying.

## Send

```ts
const result = await env.CHASKI.send({
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
| `channels` | Narrows the send to some of the template’s channels, such as `['email']`. A channel that isn’t on fails the send. |
| `transactional` | `true` sends whatever the contact’s preferences say: receipts, password resets, security alerts. |
| `email` | `fromName`, `replyTo`, and up to 10 `attachments` (`filename`, `contentType`, and base64 `content` or a `url`); attachments need `CHASKI_ATTACHMENTS`. Chaski deletes them once the email goes out or its schedule is cancelled; a failed or dead delivery keeps them for a replay, so suggest an R2 lifecycle rule on `att/` that outlasts the farthest schedule with attachments. |
| `push` | `silent: true` shows the push’s alert without a sound on Apple devices, on Windows and in browsers; on Android the app’s notification channel decides the sound. `collapseId` (up to 64 printable ASCII characters) replaces a push already shown with the same id, and becomes the push’s `tag`. |
| `locale` | The language of this send alone, ahead of `recipient.locale`, and never saved to the contact: a receipt in the language of the checkout, say. |
| `data` | Up to 20 string values for the app’s clients, such as its own event id: the feed item (`data`) and every push carry them as they came. Keys are letters, digits and `_`; `aps`, `href`, `tag`, `from`, `message_type`, `collapse_key` and keys starting with `google` or `gcm` are refused. |
| `idempotencyKey` | The same key returns the first send’s result (`replayed: true`) instead of sending again. |
| `inline` | `true` delivers the email before `send()` returns, for someone waiting on it; needs `transactional: true` and `channels: ['email']`. |

Derive the idempotency key from the event the notification is about, such as the payment or the
order, so a retried request or a redelivered queue message sends once.

`send()` records the notification and puts one delivery per channel on Chaski’s queue; it doesn’t
wait for providers, except with `inline` (below). It returns
`{ notificationId, replayed, outcome, deliveries }`:

- `outcome: 'delivered'`: at least one channel took it.
- `outcome: 'suppressed'`: the contact’s preferences skipped every channel.
- `outcome: 'undeliverable'`: the channel settings or the contact’s data skipped every channel.

A skipped delivery carries a `reason`: `channel_not_configured`, `muted_by_preferences`,
`missing_email`, `no_device_tokens` or `no_template`.

### Inline, for someone waiting

A password reset, a verification or a sign-in link has a person on screen waiting for the email.
Send those with `inline: true`, `transactional: true` and `channels: ['email']`: Chaski delivers
the email before `send()` returns and throws `ChaskiError` with the code `delivery_failed` when the
provider doesn’t take it, or `channel_paused` when someone paused email in the dashboard, so the
route answers the person with an error instead of a silent success. Handle both the same way. The
delivery is recorded and shows in the dashboard as usual; a failed one isn’t retried in the
background, and a paused one waits there as held. With an `idempotencyKey`, a second request tries
a failed or held email again and returns one that went out as it was. Everything else (receipts,
digests, reminders) stays on the queue, which retries with backoff.

## Schedule

```ts
await env.CHASKI.schedule({
  type: 'invoice_due',
  recipient: { id: user.id, email: user.email },
  payload: { invoice: 'INV-1042' },
  scheduledAt: '2026-11-01T09:00:00-05:00',
  idempotencyKey: 'invoice_due:INV-1042',
  groupKey: `trial:${trial.id}`, // optional, to cancel several at once
});

await env.CHASKI.schedules().cancel({ idempotencyKey: 'invoice_due:INV-1042' });
await env.CHASKI.schedules().cancel({ groupKey: `trial:${trial.id}` });
const pending = await env.CHASKI.schedules().list({ recipientId: user.id });
```

- `scheduledAt` is ISO 8601 with an explicit offset (`Z` or `±hh:mm`); a time in the past is
  rejected, with five minutes of grace.
- Scheduling again with the same `idempotencyKey` moves the pending send instead of adding one, so
  derive the key from what the notification is about, never from the time. The result’s `op` says
  what happened: `created`, `updated`, `completed` (it already went out, and nothing changed) or
  `cancelled` (the new time had passed). Something that arms again after it fired needs a new key
  each time.
- Preferences and the template, its translations included, are read when the send fires, not
  when it’s scheduled; the language it asks for is the one at scheduling.
- A schedule is one send at one time. Something that repeats, such as a weekly digest, stays a
  Cron Trigger in the app whose handler calls `env.CHASKI.send()`.
- It needs `CHASKI_SCHEDULER` bound in the Chaski Worker.

## Preferences

A contact’s preferences are channels they turned off and types they muted:

```ts
await env.CHASKI.preferences().set(user.id, {
  channels: { email: false },                     // merges key by key
  mutedTypes: ['marketing.*', 'push:reminder.*'], // overwrites the whole list
});
const { channels, mutedTypes } = await env.CHASKI.preferences().get(user.id);
const topics = await env.CHASKI.preferences().topics(); // types grouped by their template's topic
```

- A `mutedTypes` entry ending in `*` mutes every type starting with it; a `channel:` prefix limits
  it to that channel.
- `mutedTypes` overwrites the stored list on every `set`: send the full list.
- **Muted by default**, on the dashboard’s **Channels** page, mutes types for every contact
  until they save preferences of their own, for opt-in types such as a digest. `get()` for a
  contact who never saved returns those defaults, with every channel on.
- Every send checks preferences channel by channel, except `transactional: true` sends.

## Feed and devices on the server

```ts
await env.CHASKI.feed().list({ recipientId: user.id, limit: 20 });    // { items, nextCursor }
await env.CHASKI.feed().unreadCount(user.id);                         // { unread }
await env.CHASKI.feed().markRead({ recipientId: user.id, ids: [id] }); // or before, or neither for all

await env.CHASKI.push().register({ recipient: { id: user.id }, platform: 'ios', deviceToken });
await env.CHASKI.push().register({ recipient: { id: user.id }, platform: 'macos', deviceToken });
await env.CHASKI.push().register({ recipient: { id: user.id }, platform: 'windows', deviceToken: channelUri });
await env.CHASKI.push().register({ recipient: { id: user.id }, platform: 'android', deviceToken }); // FCM
await env.CHASKI.push().register({ recipient: { id: user.id }, subscription }); // a web push subscription
await env.CHASKI.push().unregister({ deviceToken });
```

Registering an endpoint or a device token Chaski already knows hands it to this contact, so a
repeat is safe.

The frontend reaches the same data as the signed-in user through the app’s `userRoutes()`; see
[browser-clients.md](browser-clients.md).

## Errors

Chaski throws `ChaskiError` with a `code`: `validation` (fix the request or the template),
`config` (fix the setup), `delivery_failed` (an inline email didn’t go out), `channel_paused` (an
inline email is held: email is paused in the dashboard), `not_found`, `conflict`, `unauthorized`,
`forbidden`, `internal`. Check it with `isChaskiError(error)` from `chaskijs`, never `instanceof`,
since the class doesn’t survive the service binding. `isRetryableChaskiError(error)` is `true` only
for `internal` and for errors that aren’t Chaski’s, for a job of the app that decides whether to
retry. Between two local `wrangler dev` sessions the code doesn’t cross the binding:
[troubleshooting.md](troubleshooting.md), “Local development”.
