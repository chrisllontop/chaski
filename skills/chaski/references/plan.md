# Plan the move onto Chaski

The input is the inventory from [audit.md](audit.md); the output is the plan, added to the same
file. The plan changes no code: carrying it out is a separate request from the user. Every Chaski
call below is in [sending.md](sending.md).

## 1. Sort the flows

Put every flow in one of two groups.

**Moves** when it sends email, web push, iOS push or in-app notifications from code that runs in
the Worker that hosts Chaski, or in another Worker of the same account, which calls Chaski through
`ChaskiEntrypoint` ([setup.md](setup.md) ends with it).

**Stays** on its current provider, with the reason written next to it:

- **SMS, WhatsApp, voice, Slack, Discord and other chat apps.** Chaski has no channel for them.
- **Android native push and Expo push tokens.** Chaski’s push covers web push and APNs only.
- **Code that doesn’t run in a Cloudflare Worker**, with no Worker of the account to call. Chaski
  has no HTTP API for outside callers.
- **Broadcasts to a list or an audience, and sequences built in a provider’s dashboard.** Chaski
  sends one notification to one contact per call; it has no audiences, campaigns or sequence
  builder. A sequence can become `chaski.schedule()` calls in the host, which is new code the user
  decides on.
- **Inbound email.**

Some flows move but lean on something their provider does that Chaski doesn’t: click tracking,
bounce and complaint handling with a suppression list, `List-Unsubscribe` headers, a hosted
unsubscribe page. Chaski records opens, through a pixel. Name what the flow loses, and let the
user decide whether it moves, or how the host covers it (an unsubscribe link to a host route that
calls `chaski.preferences.set()`, say).

**Done when** every flow from the inventory is in one group, and every flow that stays has its
reason.

## 2. Map each flow that moves

Write these down per flow:

- **Type.** Named after the event: `payment_received`, `billing.invoice_due`. Give related types
  a shared prefix, so one `mutedTypes` entry such as `marketing.*` mutes them all, and a `topic`
  that groups them on the preferences screen. Two code paths that send the same event on two
  channels (an email and a push) become one type with two channels and one send.
- **Template.** One per type, with an entry per channel the flow uses. Note where its content
  comes from, and convert it (below).
- **The call.** `chaski.send()` for an immediate send. `chaski.schedule()` for a delayed one-off,
  with a `groupKey` when a later event cancels several (`trial:<id>`). A recurring send stays a
  Cron Trigger in the host whose handler calls `chaski.send()` per contact.
- **Recipient.** `recipient.id` is the same user id `identify` returns in the user routes, so the
  feed, devices and preferences line up; `email` and `name` come from the user record.
- **Payload.** The template’s values, formatted in the host (money, dates), since Liquid prints
  them as given.
- **`transactional: true`** for the flows step 3 of the audit marked as must-reach.
- **Idempotency key.** From the event, never the time: `payment_received:<payment id>`, a digest’s
  `weekly_digest:<user id>:<week>`, a reminder’s `trial_ending:<trial id>`. A “sent” column the
  flow keeps today becomes this key.
- **Bindings** the flow needs beyond `db` and `queue`: `email`, `feed`, `scheduler`,
  `attachments` for email attachments.

### Converting templates to Liquid

- **Handlebars and Mustache** (SendGrid dynamic templates, Postmark): `{{name}}` stays
  `{{ name }}`, but Liquid doesn’t escape, so a value a user typed becomes `{{ name | escape }}`
  in HTML, and `{{{html}}}` becomes `{{ html }}`. `{{#if x}}…{{else}}…{{/if}}` becomes
  `{% if x %}…{% else %}…{% endif %}`; `{{#each items}}{{this.title}}{{/each}}` becomes
  `{% for item in items %}{{ item.title }}{% endfor %}`. Helpers become Liquid filters, or values
  the host formats before sending.
- **React Email**: render the component once with Liquid tags as its props, and keep the HTML:
  `await render(<Receipt amount="{{ amount }}" name="{{ recipient.name | escape }}" />)`, and with
  `{ plainText: true }` for the text body. Keep quotes out of those tags, since React escapes
  them. Props that drive a loop or a condition need that Liquid written into the output by hand.
- **MJML**: put the Liquid tags in the source, compile it to HTML (`npx mjml receipt.mjml -s`), and
  keep the output.
- **Provider-hosted templates**: ask the user to export them from the provider’s dashboard, then
  convert as above.

Write every converted template into `chaski-templates.json` next to the plan, in the import format
from [sending.md](sending.md), with `sampleData` for the preview. The user imports it in the
dashboard under **Templates**, **Import**.

### State to bring over

- **Preferences.** A global email opt-out becomes `channels: { email: false }`; a category opt-out
  becomes a `mutedTypes` entry; a type people opt into becomes `defaultMutedTypes` in the config.
  A one-off backfill calls `chaski.preferences.set(userId, …)` for each user whose choices differ
  from the defaults. From then on the settings screen reads and writes Chaski’s preferences.
- **Web push subscriptions** the host stored, made with its own VAPID pair: configure Chaski with
  that same pair, and register each one with
  `chaski.push.register({ recipient: { id }, subscription: { endpoint, keys: { p256dh, auth } } })`.
  Browsers keep their subscription, and `client.push.enable()` reuses it. Subscriptions made with
  another pair, or FCM web tokens, can’t come over: those users turn push on again once the
  frontend has Chaski’s toggle.
- **APNs device tokens**: `chaski.push.register({ recipient: { id }, platform: 'ios', deviceToken })`,
  with the same bundle id and environment in `channels.push.apns`.
- **In-app history.** Chaski’s feed starts empty and has no import; earlier items stay in the
  host’s table. Agree with the user whether the UI shows both for a while or lets the old ones go.
- **Notification services** (Knock, Novu, Courier, OneSignal, MagicBell): each workflow becomes a
  type, its channel steps the template’s channels, its delay steps `chaski.schedule()`, its digest
  or batch steps a host Cron Trigger, its inbox the in-app feed, and its subscriber preferences a
  backfill from an export.

Backfills are scripts or temporary routes that the user runs. Make them safe to run twice.

**Done when** every flow that moves has its type, channels, call, idempotency key,
`transactional` choice, template source and bindings, and every piece of stored state has its way
over or a reason it stays.

## 3. Stage it

Write the stages into the plan in this order:

1. **Chaski in dry run.** Set it up on a branch ([setup.md](setup.md)) with the bindings the
   moving flows need, import `chaski-templates.json`, and check every template in the dashboard’s
   preview. Before the first email type, the user onboards the sending domain to Email Service, a
   DNS change on their side.
2. **Backfills**, before the types that depend on them: preferences before any type that respects
   them, devices before any push type.
3. **The frontend** ([browser-clients.md](browser-clients.md)), before the in-app and web push
   types: the feed, the push toggle, the preferences screen.
4. **One type at a time**, from the least risky (internal, low volume) to the most (password
   resets and receipts last):
   1. Add the Chaski send next to the old one, behind a switch the host owns, such as a
      `CHASKI_TYPES` var listing the types Chaski sends. A listed type goes through Chaski and
      skips the old path; an unlisted one takes the old path. Never both: with dry run off, that
      sends twice.
   2. Locally, in dry run with the type listed, trigger the flow and compare the delivery in the
      dashboard (content, recipient, skipped channels) with what the old path sends.
   3. Deploy with the type unlisted, so nothing changes, then list it in production and watch
      **Deliveries** and the type’s health on the **Overview**. `dryRun` covers the whole config,
      so in production the switch is what moves types one at a time.
   4. Keep the old path and the provider’s credentials until the type has run clean for as long
      as the user wants. Unlisting the type switches back.
5. **Clean-up**, once every type has moved: delete the old send code, templates and tables, drop
   the provider’s SDK, and revoke its keys, each with the user’s go-ahead.

**Done when** every flow is in a stage or in the group that stays, the plan names its open
questions, and the user has the plan to review.
