# Plan the move onto Chaski

The input is the inventory from [audit.md](audit.md); the output is the plan, added to the same
file, and the template file with every converted template. The plan changes no code: carrying it
out is a separate request from the user. Every Chaski call below is in [sending.md](sending.md).

## 1. Sort the flows

Put every flow in one of two groups.

**Moves** when it sends email, web push, iOS, macOS, Android or Windows push or in-app notifications
from code that runs in a Cloudflare Worker of the account Chaski will run in, which calls it
through its `CHASKI` binding ([setup.md](setup.md), step 5).

**Stays** on its current provider, with the reason written next to it:

- **SMS, WhatsApp, voice, Slack, Discord and other chat apps.** Chaski has no channel for them.
- **Expo push tokens, and FCM tokens of iOS apps.** Chaski’s push covers web push, APNs, WNS,
  and FCM for Android only.
- **Code that doesn’t run in a Cloudflare Worker**, with no Worker of the account to call.
  Chaski has no HTTP API for outside callers.
- **Broadcasts to a list or an audience, and sequences built in a provider’s dashboard.** Chaski
  sends one notification to one contact per call; it has no audiences, campaigns or sequence
  builder. A sequence can become `env.CHASKI.schedule()` calls in the app, which is new code the
  user decides on.
- **Inbound email.**

Some flows move but lean on something their provider does that Chaski doesn’t:

- click tracking;
- bounce and complaint handling, with a suppression list;
- `List-Unsubscribe` headers and a hosted unsubscribe page;
- a sender address of their own: Chaski sends every email from the one sender address saved on
  its **Channels** page, and a send can change only `fromName` and `replyTo`.

Chaski records opens, through a pixel the app’s `userRoutes()` mount serves. Name what each flow
loses, and let the user decide whether it moves, or how the app covers it (an unsubscribe link to
an app route that calls `env.CHASKI.preferences().set()`, say).

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
- **The call.** `env.CHASKI.send()` for an immediate send. `env.CHASKI.schedule()` for a delayed
  one-off, with a `groupKey` when a later event cancels several (`trial:<id>`). Once a schedule
  has gone out, scheduling its key again changes nothing (`op: 'completed'`), so a flow that arms
  again after firing needs a key per arming. A recurring send stays a Cron Trigger in the app
  whose handler calls `env.CHASKI.send()` per contact.
- **Recipient.** `recipient.id` is required, and is the same user id `identify` returns in the
  user routes, so the feed, devices and preferences line up; `email` and `name` come from the
  user record. A flow that sends to an address with no user behind it (a password reset typed in,
  a list) looks the user up; when there’s none, the user decides whether it sends at all.
- **Payload.** The template’s values, formatted in the app (money, dates), since Liquid prints
  them as given. Chaski stores the payload with the notification and shows it in the dashboard’s
  delivery detail, so a secret in it, such as a password reset token or a sign-in link, is
  readable there. Point that out, and let the user decide.
- **`transactional: true`** for the flows step 3 of the audit marked as must-reach.
- **Idempotency key.** From the event, never the time: `payment_received:<payment id>`, a digest’s
  `weekly_digest:<user id>:<week>`, a reminder’s `trial_ending:<trial id>`. A “sent” column the
  flow keeps today becomes this key.
- **Bindings** the flow needs in the Chaski Worker beyond `CHASKI_DB` and `CHASKI_QUEUE`:
  `CHASKI_EMAIL`, `CHASKI_FEED`, `CHASKI_SCHEDULER`, `CHASKI_ATTACHMENTS` for email attachments.

### Converting templates to Liquid

An email body escapes every value for HTML on its own, so a converted tag needs no `escape`. A
value that holds HTML on purpose goes through `raw` instead.

- **Content written in the code** (a subject or body the send builds from strings): each value
  it splices in becomes a tag, so `` `We received ${amount}` `` becomes `We received {{ amount }}`.
  What the code computes for it (a formatted price, a link) becomes a payload field the send
  passes.
- **Handlebars and Mustache** (SendGrid dynamic templates, Postmark): `{{name}}` becomes
  `{{ name }}`, and `{{{html}}}` becomes `{{ html | raw }}`.
  `{{#each items}}{{this.title}}{{/each}}` becomes
  `{% for item in items %}{{ item.title }}{% endfor %}`. Helpers become Liquid filters, or
  values the app formats before sending.
- **Conditions.** In Liquid only `nil` and `false` are false: `0`, `''` and an empty list are
  true. So `{{#if items.length}}` becomes `{% if items.size > 0 %}`, `{{#if name}}` becomes
  `{% if name != blank %}`, and a number is compared outright (`{% if count > 0 %}`).
- **React Email.** Render the component once, with Liquid tags as its props, and keep the HTML:
  `await render(<Receipt amount="{{ amount }}" name="{{ recipient.name }}" />)`.
  - React escapes `&`, `<`, `>` and quotes in what it renders, so the tags passed as props hold
    only names and filters. Write conditions and quoted arguments into the output by hand.
  - For a list, pass one placeholder item whose fields are tags (`{{ item.title }}`), then wrap
    the element it renders in `{% for item in items %}…{% endfor %}` by hand.
  - For the text body, render again as plain text, and keep headings as written:
    `render(element, { plainText: true, htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }] } })`,
    with a selector for each heading level the email uses. By default plain text capitalizes
    headings, Liquid tags included, and Liquid then renders the capitalized names as empty.
  - It needs React Email installed. When the project’s dependencies aren’t, install
    `@react-email/render` and the components in a scratch folder outside the project, or leave
    the render to the user.
- **MJML**: put the Liquid tags in the source, compile it to HTML (`npx mjml receipt.mjml -s`), and
  keep the output.
- **Provider-hosted templates**: ask the user to export them from the provider’s dashboard, then
  convert as above.
- **Entities in plain text.** Content written for HTML, or exported from a provider, often carries
  `&middot;`, `&#8217;` or `&amp;` into subjects and push text, where Chaski shows them as typed.
  Write the characters themselves in every field but the email body; loading the file prints a
  warning for each one left.

Write every converted template into the template file ([sending.md](sending.md)), with
`sampleData` that fills every tag it uses, and note in the plan where each one came from.

### State to bring over

- **Preferences.** A global email opt-out becomes `channels: { email: false }`; a category opt-out
  becomes a `mutedTypes` entry; a type people opt into becomes a **Muted by default** entry on
  the dashboard’s **Channels** page. A contact who never saved gets those defaults, but a saved
  list takes their place: a backfilled `mutedTypes` names every default-muted type the user hasn’t
  opted into, or it opts them in. A one-off backfill calls
  `env.CHASKI.preferences().set(userId, …)` for each user whose choices differ from the defaults.
- **Web push subscriptions** the app stored, made with its own VAPID pair: paste that same pair
  into the web push settings on **Channels**, and register each subscription with
  `env.CHASKI.push().register({ recipient: { id }, subscription: { endpoint, keys: { p256dh, auth } } })`.
  Browsers keep their subscription, and `client.push.enable()` reuses it. Subscriptions made with
  another pair, or FCM web tokens, can’t come over: `client.push.state()` reports those browsers
  as not subscribed, so Chaski’s toggle offers push again, and where permission is already
  `granted`, `enable()` replaces the subscription without asking. Chaski’s pushes carry
  `{ title, body, href, tag }`; while the old path still sends pushes of another shape, the service
  worker has to show both.
- **APNs device tokens**:
  `env.CHASKI.push().register({ recipient: { id }, platform: 'ios', deviceToken })`, or
  `platform: 'macos'` for a Mac app, with the same bundle id and environment in the APNs settings’
  iOS or macOS app. Tokens of development builds add `environment: 'sandbox'`.
- **Windows channel URIs** from the Windows App SDK:
  `env.CHASKI.push().register({ recipient: { id }, platform: 'windows', deviceToken: channelUri })`,
  with the same Entra app in the WNS settings. Channels made through Partner Center credentials (a
  package SID) stay on their current sender.
- **Android FCM tokens**:
  `env.CHASKI.push().register({ recipient: { id }, platform: 'android', deviceToken })`, with a
  service account of the same Firebase project in the FCM settings.
- **In-app history.** Chaski’s feed starts empty and has no import; earlier items stay in the
  app’s table. Agree with the user whether the UI shows both for a while or lets the old ones go.
- **Notification services** (Knock, Novu, Courier, OneSignal, MagicBell): each workflow becomes a
  type, its channel steps the template’s channels, its delay steps `env.CHASKI.schedule()`, its
  digest or batch steps an app Cron Trigger, its inbox the in-app feed, and its subscriber
  preferences a backfill from an export.

Backfills are scripts or temporary routes of the app that the user runs. Make them safe to run
twice: registering a known endpoint or device token again hands it to that contact, and
`preferences().set()` with the full list gives the same result every time. From the backfill on,
every app route that changes preferences or registers a device writes to Chaski too, so nothing
changed in between is lost. The app’s own preference columns keep being written as well, for as
long as an old path reads them. A recurring send that picks its recipients by such a column (an
opt-in flag) reads it until the column goes; afterwards it sends to everyone it could reach and
lets preferences skip the rest, each skipped send recorded as `suppressed`.

**Done when** every flow that moves has its type, channels, call, idempotency key,
`transactional` choice, template source and bindings; the template file holds a template for every
type, with `sampleData` that fills every tag it uses; and every piece of stored state has its way
over or a reason it stays.

## 3. Stage it

Write the stages into the plan in this order:

1. **Chaski, locally.** Set it up on a branch ([setup.md](setup.md)) with the bindings the
   moving flows need. Load the template file into the local database ([sending.md](sending.md)),
   and the user checks each template in the dashboard’s preview. Before the first email type, the
   user onboards the sending domain to Email Service, a DNS change on their side.
2. **Backfills**, before the types that depend on them: preferences before any type that respects
   them, devices before any push type, with the double writes above from the same deploy.
3. **The frontend** ([browser-clients.md](browser-clients.md)), before the in-app and web push
   types: the feed and the push toggle. The preferences screen switches to Chaski’s preferences
   once no old path reads the app’s columns; until then it writes both.
4. **One type at a time**, from the least risky (internal, low volume) to the most (password
   resets and receipts last):
   1. Add the Chaski send next to the old one, behind a switch the app owns, such as a
      `CHASKI_TYPES` var listing the types Chaski sends. A listed type goes through Chaski and
      skips the old path; an unlisted one takes the old path, so each send goes out exactly once.
   2. Locally, trigger the flow twice: unlisted, to see what the old path sends, and listed, to
      see Chaski’s delivery in the dashboard (content, recipient, skipped channels) and its email
      under the Chaski project’s `.wrangler/tmp/email/`. Compare the two. With its provider key
      set, the old path sends for real even locally: point it at a test address, or log what it
      would send.
   3. Load its template into production (the template file’s `--remote` load in
      [sending.md](sending.md), with the user’s go-ahead). Deploy the app with the type unlisted,
      so nothing changes, then list it in production and watch **Deliveries** and the type’s
      health on the **Overview**. If it misbehaves, pause its channel in **Channels**: its
      deliveries wait as held while the type is unlisted, then send or discard them.
   4. Keep the old path and the provider’s credentials until the type has run clean for as long
      as the user wants. Unlisting the type switches back.
5. **Clean-up**, once every type has moved: delete the old send code, templates and tables, drop
   the provider’s SDK, and revoke its keys, each with the user’s go-ahead.

**Done when** every flow is in a stage or in the group that stays, the plan names its open
questions, and the user has the plan to review.
