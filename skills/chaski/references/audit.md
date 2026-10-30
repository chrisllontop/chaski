# Audit the notifications a codebase sends

The audit reads the project and writes an **inventory**: every flow that sends email, push or
in-app notifications, what it sends, when, to whom, on which channel and with which template.
[plan.md](plan.md) then turns the inventory into a plan for moving those flows onto Chaski. The
audit changes no code. It writes the finder’s output to a temporary file, then `chaski-plan.md` in
the project.

## 1. Map the project

List every deployable unit in the repository and its runtime: each Worker (one per Wrangler
config), server, frontend, mobile app, background job and script. Note which ones run on
Cloudflare Workers, since only those can bind to a Chaski Worker, and whether a Chaski project or
a `CHASKI` service binding already exists.

**Done when** every folder holding code that runs somewhere is on the list with its runtime, and
so is every runtime the code implies but the repository doesn’t hold (a service worker with no
frontend that serves it, a webhook from another system).

## 2. Find every send

Run the finder from this skill’s folder (the one holding `SKILL.md`) against the project root, and
keep its output:

```sh
node <skill folder>/scripts/find-sends.mjs <project root> > "${TMPDIR:-/tmp}/chaski-sends.txt"
```

When you read the skill from chaski.sh, it isn’t on disk: download the finder into a temporary
folder, then run it with Node. Keep it in a `scripts` folder of its own, since it skips everything
under its parent folder as the skill’s:

```sh
mkdir -p "${TMPDIR:-/tmp}/chaski-skill/scripts"
curl -fsSL https://chaski.sh/skill/scripts/find-sends.mjs \
  -o "${TMPDIR:-/tmp}/chaski-skill/scripts/find-sends.mjs"
node "${TMPDIR:-/tmp}/chaski-skill/scripts/find-sends.mjs" <project root> \
  > "${TMPDIR:-/tmp}/chaski-sends.txt"
```

It prints counts, then each hit as `file:line: code`, under these headings: packages,
credentials, other settings, template files, message catalogs, translated sends, email, push,
notification services, other sends, sms and chat, templates, jobs and schedules, i18n, preferences
and devices, in-app feed. Message catalogs are the app’s translation files and the templates kept
per language; translated sends are translation calls (`t('…')`, `formatMessage`, `gettext`) within
a few lines of a send, the text a send carries already translated. From `.env` and
`.dev.vars` files it reads only the names of the settings, never their values. It matches
patterns: it flags lines that send nothing, and it misses sends it has no pattern for. A provider
missing from its lists shows up only as candidates: a package marked `unknown`, whose name sounds
like a sender or matches a setting’s prefix, and the `*_API_KEY`, `*_SECRET`, `*_TOKEN` and
`*_URL` settings under other settings. Zero hits under packages doesn’t mean nothing to move. So go
past it:

- **Wrappers.** For every module that imports a provider SDK, calls a provider’s API or writes to
  an in-app notifications table of the app’s own, list the functions it exports, then find every
  call of each. The call sites are the flows; the wrapper is only the provider.
- **Handlers.** Read every `scheduled` and `queue` handler, every Cron Trigger in the Wrangler
  configs and every job runner’s jobs to the end: digests and reminders hide there.
- **Credentials.** Each name under the finder’s credentials heading (`RESEND_API_KEY`,
  `VAPID_PRIVATE_KEY`, `SLACK_WEBHOOK_URL`…) is a provider the code talks to, even when the call
  itself matched no pattern. Follow every place that reads it to the send. Do the same for each
  name under other settings until you know what it reaches: most are the database, auth or
  storage, and one may be a provider the finder doesn’t list.
- **Outside the code.** Provider-hosted templates (SendGrid dynamic templates, Postmark templates)
  and workflows in a notification service (Knock, Novu, Courier, OneSignal) hold content and
  steps the code only names by id. Automations configured in a provider’s dashboard, such as an
  email sequence, send with no call site at all. List each id you find, and ask the user about
  what lives only in a dashboard.
- **Languages.** An i18n package, message catalogs or templates per language mean the app sends
  in more than one language. Find how it picks one (a user setting, a request’s
  `Accept-Language`, a team’s or an account’s language), which languages it ships, and which it
  falls back to. Each translated send is a flow whose text moves into its template’s
  translations ([plan.md](plan.md)).
- **Chaski itself**, when step 1 found it. The Chaski project’s folder, its `CHASKI_*` settings and
  the `chaskijs` package are Chaski’s own: dismiss their hits. The flows already on Chaski are the
  calls through the binding, which the finder has no pattern for: search for `CHASKI.send(` and
  `CHASKI.schedule(`, and record each as a flow that has moved.

**Done when** every line the finder printed belongs to a flow in step 3 or is dismissed with a
reason (a test, a type, a comment, an unrelated match), and every wrapper’s callers are found.

## 3. Trace each flow

A **flow** is one kind of message the product sends, such as the receipt after a payment or the
weekly digest. Trace each one from its send back to its trigger, and record:

| Field | Record |
| --- | --- |
| What | What the message tells the reader, in product terms. |
| Trigger | The event or schedule that sends it: a route, a webhook, a user action, a queue message, a cron expression. |
| Recipients | Who gets it, where the address or device comes from, and the user id behind it, or that there’s none. |
| Channels | Email, web push, iOS push, macOS push, Android push, Windows push, in-app, SMS, chat. |
| Provider | The SDK or service, with the `file:line` of the send. |
| Template | Where the content lives: a file (React Email, MJML, Handlebars, inline HTML), a provider-hosted template id, or a string in code. |
| Data | The values the content uses, and which ones the app formats (money, dates) before sending. |
| Languages | The languages it sends in, where each one’s text lives (catalog keys, a template per language) and what picks the language; or one language. |
| Timing | Immediate; delayed, and by what (a queue’s `delaySeconds`, a provider’s `send_at`, a timer); or recurring, with the schedule. |
| Dedupe | What stops a double send today: an idempotency key, a “sent” column, nothing. |
| Preferences | What’s checked before sending: an opt-out column, an unsubscribe list, nothing. Mark the flows that must reach the reader whatever they chose: receipts, password resets, security alerts. |
| Runtime | The unit from step 1 that runs the send. |

Record the state the flows depend on as well: preference and opt-out tables and columns,
unsubscribe tokens and links, stored push subscriptions (web push endpoints and keys, FCM tokens,
APNs tokens, Expo tokens) with the VAPID key pair they were made with, and in-app notification
tables with the UI that reads them.

**Done when** every flow has every field, or `unknown` with what would answer it, which is usually
a question for the user.

## 4. Write the inventory

Write it to `chaski-plan.md` at the project root, unless the user named another place:

1. A summary table, one row per flow: id (`F1`, `F2`…), what, channels, provider, timing.
2. One section per flow with every field from step 3.
3. The stored state.
4. The questions for the user.
5. The finder’s evidence: its command and counts, which hits went to which flow or state, which
   were dismissed and why, and what you found past it.

Then read [plan.md](plan.md) and add the plan to the same file.
