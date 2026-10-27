#!/usr/bin/env node
// Lists the places a codebase may send email, push or in-app notifications, for the audit in
// references/audit.md. It finds candidates by pattern; reading each one is the agent's job.
// Usage: node find-sends.mjs [project root]. Node 18 or later, no dependencies.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const self = fileURLToPath(new URL('..', import.meta.url));

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.wrangler',
  '.cache',
  '.expo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'Pods',
  'target',
  'vendor',
  'venv',
]);

const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock']);

const CODE = new Set(
  '.ts .tsx .mts .cts .js .jsx .mjs .cjs .vue .svelte .astro .py .rb .go .php .java .kt .cs .rs .ex .exs .json .jsonc .toml .yaml .yml .sql .prisma'.split(
    ' ',
  ),
);

const TEMPLATE_FILES = new Set(
  '.mjml .hbs .handlebars .liquid .mustache .njk .ejs .pug .eta'.split(' '),
);

// Package names, matched exactly or, when they end in '/', as a scope prefix.
const PACKAGES = {
  email: [
    'resend',
    '@sendgrid/mail',
    '@sendgrid/client',
    'postmark',
    'mailgun.js',
    'mailgun-js',
    '@aws-sdk/client-ses',
    '@aws-sdk/client-sesv2',
    'nodemailer',
    '@mailchimp/mailchimp_transactional',
    'mandrill-api',
    '@getbrevo/brevo',
    'sib-api-v3-sdk',
    'sparkpost',
    'mailersend',
    '@plunk/node',
    'loops',
    'mailtrap',
    'mimetext',
    'email-templates',
  ],
  templates: ['@react-email/', 'react-email', 'mjml', 'handlebars', 'juice', 'liquidjs'],
  push: [
    'web-push',
    'firebase-admin',
    'firebase',
    '@firebase/messaging',
    '@react-native-firebase/messaging',
    '@parse/node-apn',
    'apn',
    'node-apn',
    'apns2',
    '@onesignal/node-onesignal',
    'onesignal-node',
    'react-onesignal',
    'expo-server-sdk',
    'expo-notifications',
  ],
  'notification services': [
    '@knocklabs/',
    '@novu/',
    '@trycourier/',
    'magicbell',
    '@magicbell/',
    '@suprsend/',
  ],
  'sms and chat': [
    'twilio',
    '@vonage/server-sdk',
    'plivo',
    'telnyx',
    'messagebird',
    '@aws-sdk/client-sns',
    '@aws-sdk/client-pinpoint',
    '@slack/web-api',
    '@slack/webhook',
    'discord.js',
  ],
  'jobs and schedules': [
    'node-cron',
    'cron',
    'bull',
    'bullmq',
    'agenda',
    'bree',
    '@upstash/qstash',
    'inngest',
    '@trigger.dev/sdk',
  ],
};

const PATTERNS = {
  email: [
    /\b(?:resend|emails)\.send\w*\(/,
    /\bsgMail\.send/,
    /\.sendMail\(/,
    /\bsend\w*(?:Email|Mail)\w*\s*\(/,
    /\bSend(?:Raw|Templated|BulkTemplated|Bulk)?EmailCommand\b/,
    /\bnew EmailMessage\(|cloudflare:email/,
    /api\.resend\.com|api\.sendgrid\.com|api\.postmarkapp\.com|api(?:\.eu)?\.mailgun\.net/,
    /email\.[\w-]+\.amazonaws\.com|api\.mailchannels\.net|api\.brevo\.com|api\.sendinblue\.com/,
    /mandrillapp\.com|api\.sparkpost\.com|api\.mailersend\.com|api\.useplunk\.com|app\.loops\.so/,
    /\bsmtp\.[\w-]+\.\w+|\bSMTP_(?:HOST|USER|PASS)/,
  ],
  push: [
    /\bwebpush\.\w+\(|\bsendNotification\(|\bsetVapidDetails\(|VAPID/,
    /\bmessaging\(\)\.\w+\(|\bgetMessaging\(|fcm\.googleapis\.com|\bsendEachForMulticast\(/,
    /api(?:\.sandbox)?\.push\.apple\.com|\bapn\.Provider\b|\bnew apn\.|\bApnsClient\b/,
    /onesignal\.com\/api|\bcreateNotification\(/,
    /exp\.host\/--\/api\/v2\/push|\bsendPushNotificationsAsync\(/,
    /pushManager\.subscribe\(|addEventListener\(\s*['"](?:push|notificationclick)['"]/,
    /\bshowNotification\(/,
  ],
  'notification services': [
    /\bworkflows\.trigger\(|api\.knock\.app/,
    /\bnovu\.\w+\(|api\.novu\.co/,
    /\bcourier\.send\w*\(|api\.courier\.com/,
    /api\.magicbell\.com|\bsuprsend\b/i,
  ],
  'other sends': [
    /\bnoti[f]y\w*\s*\(/i,
    /\bsend\w*(?:Notification|Push|Alert|Digest|Reminder|Message|Sms)\w*\s*\(/,
    /\b(?:enqueue|queue|dispatch|schedule)\w*(?:Email|Mail|Notification|Push|Digest|Reminder)\w*\s*\(/,
  ],
  'sms and chat': [
    /api\.twilio\.com|\btwilio\(|\.messages\.create\(/,
    /hooks\.slack\.com|chat\.postMessage|discord(?:app)?\.com\/api\/webhooks/,
    /\bPublishCommand\b|\bsns\.publish\(|\bvonage\b|\bplivo\b|\btelnyx\b/i,
  ],
  templates: [
    /@react-email\/|from ['"]react-email|\brender(?:Async)?\(\s*(?:<|$)/,
    /\bmjml2html\(|\bHandlebars\.compile\(|\bhandlebars\.compile\(/,
    /\btemplate_?id\b|\bTemplateAlias\b|\bTemplateModel\b|dynamic_?[Tt]emplate_?[Dd]ata/,
  ],
  'jobs and schedules': [
    /\basync\s+scheduled\s*\(|\bscheduled\s*:\s*async|\bcrons\b|\[triggers\]/,
    /\basync\s+queue\s*\(|\bqueue\s*:\s*async|queues\.consumers|\[\[queues\.consumers\]\]/,
    /\bcron\.schedule\(|\bnew CronJob\(|\bdelaySeconds\b|\bsetAlarm\(|\bstep\.sleep(?:Until)?\(/,
    /\bsend_?at\b|\bsendAt\b|\bscheduled_?at\b|\bdeliver_?at\b/i,
    // A "sent" marker is how a flow avoids sending twice.
    /\w*sent_?at\b|\bis_?sent\b|\bsent_?flag\b/i,
  ],
  'preferences and devices': [
    /(?:notification|notif|email|push|sms)_?(?:pref|setting|opt)\w*/i,
    /unsubscrib\w*|\bopt_?out\w*|\bopted_?out\b|marketing_?(?:emails?|opt\w*)/i,
    /(?:email|push|sms|digest)_?(?:enabled|frequency)\b/i,
    /push_?subscriptions?|device_?tokens?|fcm_?tokens?|apns_?tokens?|\bp256dh\b|expo_?push_?token/i,
  ],
  'in-app feed': [
    /\bnotifications?\b.*\b(?:read_?at|is_?read|seen_?at|unread)\b/i,
    /\b(?:INSERT\s+INTO|FROM|UPDATE)\s+["'`]?\w*notifications?\b/i,
    /\b(?:add|create|insert|push|save)\w*(?:Inbox|Notification|Feed)\w*\s*\(/,
    /\bunread_?count\b|\bunreadCount\b|\bmark_?as_?read\b|\bmarkAsRead\b/i,
    /@knocklabs\/react|@novu\/react|@magicbell\/react|\bNotificationCenter\b|\bNotificationFeed\b/,
  ],
};

// Names of settings that hold a provider's key or address, such as RESEND_API_KEY.
const CREDENTIAL =
  /\b[A-Z0-9_]*(?:RESEND|SENDGRID|POSTMARK|MAILGUN|SES|SMTP|MAIL|VAPID|FCM|FIREBASE|APNS|ONESIGNAL|KNOCK|NOVU|COURIER|MAGICBELL|TWILIO|VONAGE|SLACK|DISCORD|WEBHOOK)[A-Z0-9_]*\b/g;

// Env files hold secrets: only the names of their settings are read, never the values.
const ENV_FILE = /^\.(?:env|dev\.vars)(?:\..+)?$/;

const hits = new Map(Object.keys(PATTERNS).map((category) => [category, []]));
const packages = [];
const templateFiles = [];
const credentials = new Map();

const recordCredentials = (text, where) => {
  for (const name of text.match(CREDENTIAL) ?? []) {
    if (!/[A-Z0-9]_[A-Z0-9]/.test(name)) continue;
    credentials.set(name, [...(credentials.get(name) ?? []), where]);
  }
};

const record = (category, line) => {
  const list = hits.get(category) ?? [];
  list.push(line);
  hits.set(category, list);
};

const packageCategory = (name) =>
  Object.entries(PACKAGES).find(([, names]) =>
    names.some((known) => (known.endsWith('/') ? name.startsWith(known) : name === known)),
  )?.[0];

const scanPackageJson = (path, text) => {
  try {
    const manifest = JSON.parse(text);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        const category = packageCategory(name);
        if (category) packages.push(`${path}: ${name}@${version} (${category})`);
      }
    }
  } catch {
    // An unreadable manifest still gets the line scan below.
  }
};

const isEmailPath = (path) =>
  path.split(sep).some((part) => /^(?:e-?mails?|mail|mailers?|email-templates)$/i.test(part));

const scanFile = (path) => {
  const rel = relative(root, path);
  const ext = extname(path).toLowerCase();
  if (TEMPLATE_FILES.has(ext) || (isEmailPath(rel) && /\.(?:html|tsx|jsx)$/.test(ext))) {
    templateFiles.push(rel);
  }
  if (ENV_FILE.test(basename(path))) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        recordCredentials(line.split('=')[0] ?? '', `${rel}:${index + 1}`);
      });
    return;
  }
  if (!CODE.has(ext) || statSync(path).size > 1_000_000) return;
  const text = readFileSync(path, 'utf8');
  if (basename(path) === 'package.json') scanPackageJson(rel, text);
  text.split('\n').forEach((line, index) => {
    recordCredentials(line, `${rel}:${index + 1}`);
    for (const [category, patterns] of Object.entries(PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(line))) {
        record(category, `${rel}:${index + 1}: ${line.trim().slice(0, 160)}`);
      }
    }
  });
};

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // This skill, wherever an agent installed it, would match its own patterns.
    if (path.startsWith(self) || path.includes(`${sep}skills${sep}chaski${sep}`)) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path);
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name) && !/\.min\.js$|\.map$/.test(path)) {
      scanFile(path);
    }
  }
};

walk(root);

const sections = [
  ['packages', packages],
  ['credentials', [...credentials].map(([name, where]) => `${name}: ${where.join(', ')}`)],
  ['template files', templateFiles],
  ...hits.entries(),
];
const distinct = new Set(
  [...hits.values()].flat().map((line) => line.slice(0, line.indexOf(': '))),
);
console.log(`Candidates under ${root} (${distinct.size} distinct lines of code)`);
for (const [name, lines] of sections) console.log(`  ${name}: ${lines.length}`);
for (const [name, lines] of sections) {
  if (lines.length === 0) continue;
  console.log(`\n## ${name}\n`);
  for (const line of lines) console.log(line);
}
