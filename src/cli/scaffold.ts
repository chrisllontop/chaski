import { randomBytes } from 'node:crypto';
import type { PackageManager } from './package-manager';
import { resourceNames } from './wrangler-config';

/** What `chaskijs/worker` exports, which the project's main module re-exports whole. */
export const WORKER_EXPORTS = [
  'ChaskiEntrypoint',
  'ChaskiEvents',
  'ChaskiFeed',
  'ChaskiScheduler',
  'default',
];

/** The Durable Object classes of `chaskijs/worker`, each needing a migration once bound. */
export const DURABLE_OBJECT_CLASSES = ['ChaskiFeed', 'ChaskiEvents'];

// The date Chaski's own tests run the Worker under (test/fixture/wrangler.jsonc).
export const COMPATIBILITY_DATE = '2026-10-15';

export const MIGRATIONS_DIR = 'node_modules/chaskijs/migrations';

export const MAIN_MODULE = `export { ${WORKER_EXPORTS.join(', ')} } from 'chaskijs/worker';\n`;

export type ProjectOptions = {
  worker: string;
  email: boolean;
  attachments: boolean;
  publicUrl?: string;
  identity: { email: string; name: string };
  /** The `chaskijs` version that wrote the project, which it then depends on. */
  version: string;
  packageManager: PackageManager;
};

const wranglerConfig = ({ worker, email, attachments, publicUrl, identity }: ProjectOptions) => {
  const names = resourceNames(worker);
  const json = JSON.stringify;
  const vars = [
    '    // Shown in the dashboard and returned by ready().',
    `    "CHASKI_ENVIRONMENT": "production"${publicUrl ? ',' : ''}`,
    ...(publicUrl
      ? [
          '    // Where your app mounts userRoutes(); emails track opens through it.',
          `    "CHASKI_PUBLIC_URL": ${json(publicUrl)}`,
        ]
      : []),
  ];
  const optional = [
    ...(attachments
      ? [
          `  "r2_buckets": [{ "binding": "CHASKI_ATTACHMENTS", "bucket_name": ${json(names.bucket)} }]`,
        ]
      : []),
    ...(email ? ['  "send_email": [{ "name": "CHASKI_EMAIL" }]'] : []),
  ];
  return `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": ${json(worker)},
  "main": "src/index.ts",
  "compatibility_date": "${COMPATIBILITY_DATE}",
  "observability": { "enabled": true },
  "vars": {
${vars.join('\n')}
  },
  // wrangler dev signs this identity in, as Cloudflare Access does once deployed.
  "access": {
    "dev": { "aud": "chaski-local", "identity": { "email": ${json(identity.email)}, "name": ${json(identity.name)} } }
  },
  "d1_databases": [
    {
      "binding": "CHASKI_DB",
      "database_name": ${json(names.database)},
      // chaskijs deploy creates the database and writes its id here.
      "database_id": "local",
      // Chaski's tables come from the package.
      "migrations_dir": "${MIGRATIONS_DIR}"
    }
  ],
  "queues": {
    "producers": [{ "binding": "CHASKI_QUEUE", "queue": ${json(names.queue)} }],
    "consumers": [
      {
        "queue": ${json(names.queue)},
        "max_batch_size": 10,
        "max_batch_timeout": 1,
        // Chaski counts on five retries.
        "max_retries": 5,
        "dead_letter_queue": ${json(names.deadLetterQueue)}
      }
    ]
  },
  "durable_objects": {
    "bindings": [
      { "name": "CHASKI_FEED", "class_name": "ChaskiFeed" },
      { "name": "CHASKI_EVENTS", "class_name": "ChaskiEvents" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChaskiFeed", "ChaskiEvents"] }],
  "workflows": [
    { "name": ${json(names.workflow)}, "binding": "CHASKI_SCHEDULER", "class_name": "ChaskiScheduler" }
  ]${optional.length ? ',' : ''}
${optional.join(',\n')}${optional.length ? '\n' : ''}}
`;
};

const packageJson = ({ worker, version }: ProjectOptions) =>
  `${JSON.stringify(
    {
      name: worker,
      private: true,
      type: 'module',
      // `deploy`, like `install` or `publish`, is a command of the package manager itself, which
      // pnpm runs instead of a script by that name: the docs call `chaskijs deploy` directly.
      scripts: { dev: 'wrangler dev' },
      dependencies: { chaskijs: `^${version}`, hono: '^4.8.0' },
      devDependencies: { wrangler: '^4' },
    },
    null,
    2,
  )}\n`;

const devVars = ({ publicUrl }: ProjectOptions) =>
  [
    `CHASKI_SECRET=${randomBytes(32).toString('base64')}`,
    'CHASKI_ENVIRONMENT=local',
    ...(publicUrl ? [`CHASKI_PUBLIC_URL=${publicUrl}`] : []),
    '',
  ].join('\n');

/** The files of a new Chaski project, by path. */
export const projectFiles = (options: ProjectOptions): Record<string, string> => ({
  'package.json': packageJson(options),
  'wrangler.jsonc': wranglerConfig(options),
  'src/index.ts': MAIN_MODULE,
  '.gitignore': 'node_modules\n.wrangler\n.dev.vars*\n',
  '.dev.vars': devVars(options),
  // Yarn 2 and later install without node_modules by default, and Wrangler reads Chaski's
  // migrations from there.
  ...(options.packageManager.name === 'yarn' && (options.packageManager.major ?? 1) >= 2
    ? { '.yarnrc.yml': 'nodeLinker: node-modules\n' }
    : {}),
  // pnpm 11 and later fail the install over build scripts nobody allowed, and Wrangler's
  // workerd and esbuild have them.
  ...(options.packageManager.name === 'pnpm'
    ? { 'pnpm-workspace.yaml': 'allowBuilds:\n  esbuild: true\n  workerd: true\n' }
    : {}),
});
