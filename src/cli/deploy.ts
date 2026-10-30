import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError, type Context, runOrFail } from './context';
import {
  attachmentsBucket,
  CHASKI_DB,
  databaseIndex,
  declaredQueues,
  type Environment,
  envArgs,
  environment,
  label,
  parseConfig,
  readConfig,
  setIn,
  writeConfig,
} from './wrangler-config';

export type DeployFlags = { env?: string; yes?: boolean };

type Step = { title: string; act: () => Promise<void> };

const newSecret = () => randomBytes(32).toString('base64');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wrangler's `--json` output, past any line it prints before it. */
const parseJson = <T>(stdout: string, command: string): T => {
  const start = stdout.search(/^[[{]/m);
  try {
    return JSON.parse(stdout.slice(Math.max(start, 0))) as T;
  } catch {
    throw new CliError(`Couldn't read what ${command} printed:\n${stdout.trim()}`);
  }
};

// Wrangler can't ask which account to use without a terminal, and its commands here never get one.
const accountEnv = async (
  context: Context,
  env: Environment,
  accounts: { id: string; name: string }[],
  configured: string | undefined,
): Promise<Record<string, string>> => {
  if (configured || context.env.CLOUDFLARE_ACCOUNT_ID || accounts.length < 2) return {};
  if (!context.interactive) {
    throw new CliError(
      'Your login reaches more than one Cloudflare account: name one with CLOUDFLARE_ACCOUNT_ID, ' +
        `or account_id in wrangler.jsonc`,
    );
  }
  const index = await context.prompts.select(
    `Which Cloudflare account gets ${env.worker}?`,
    accounts.map((account) => `${account.name} (${account.id})`),
  );
  return { CLOUDFLARE_ACCOUNT_ID: accounts[index]?.id ?? '' };
};

export const deploy = async (context: Context, flags: DeployFlags) => {
  const file = readConfig(context.cwd);
  const config = parseConfig(file);
  const env = environment(config, flags.env);
  const cwd = dirname(file.path);
  const envFlags = envArgs(env);

  const index = databaseIndex(env.scope);
  const database = env.scope.d1_databases?.[index];
  if (!database?.database_name) {
    throw new CliError(`${label(env)} of wrangler.jsonc declares no CHASKI_DB database to deploy`);
  }
  const databaseName = database.database_name;

  const whoami = await context.run('wrangler', ['whoami', '--json'], { cwd, capture: true });
  if (whoami.code !== 0) throw new CliError('Sign in to Cloudflare first: npx wrangler login');
  const { accounts = [] } = parseJson<{ accounts?: { id: string; name: string }[] }>(
    whoami.stdout,
    'wrangler whoami',
  );
  const account = await accountEnv(
    context,
    env,
    accounts,
    env.scope.account_id ?? config.account_id,
  );
  const wrangler = (args: string[], options: { capture?: boolean; input?: string } = {}) =>
    context.run('wrangler', [...args, ...envFlags], { cwd, env: account, ...options });
  const wranglerOrFail = (args: string[], options: { capture?: boolean; input?: string } = {}) =>
    runOrFail(context, 'wrangler', [...args, ...envFlags], { cwd, env: account, ...options });

  // Wrangler answers `secret list` for a Worker that was never deployed with an error that names
  // it, which tells a first deploy apart from a Worker that runs without the secret.
  const secretState = async (): Promise<'set' | 'missing' | 'no worker'> => {
    const listed = await wrangler(['secret', 'list', '--format', 'json'], { capture: true });
    if (listed.code === 0) {
      const names = parseJson<{ name: string }[]>(listed.stdout, 'wrangler secret list');
      return names.some((each) => each.name === 'CHASKI_SECRET') ? 'set' : 'missing';
    }
    if (/Worker "[^"]+"( \(env: [^)]+\))? not found/.test(listed.stderr + listed.stdout)) {
      return 'no worker';
    }
    throw new CliError(`wrangler secret list failed\n${(listed.stderr || listed.stdout).trim()}`);
  };

  const listDatabases = async () =>
    parseJson<{ uuid: string; name: string }[]>(
      (await wranglerOrFail(['d1', 'list', '--json'], { capture: true })).stdout,
      'wrangler d1 list',
    );

  context.print(`Checking what ${env.worker} needs in your Cloudflare account…`);
  const databases = await listDatabases();
  const listed = UUID.test(database.database_id ?? '')
    ? databases.find((each) => each.uuid === database.database_id)
    : undefined;
  const bucket = attachmentsBucket(env.scope);
  const [secret, missingQueues, bucketMissing] = await Promise.all([
    secretState(),
    Promise.all(
      declaredQueues(env.scope).map(async (queue) =>
        (await wrangler(['queues', 'info', queue], { capture: true })).code === 0 ? [] : [queue],
      ),
    ).then((queues) => queues.flat()),
    bucket
      ? wrangler(['r2', 'bucket', 'info', bucket], { capture: true }).then(({ code }) => code !== 0)
      : false,
  ]);

  const steps: Step[] = [];
  if (!listed) {
    // A database by that name, such as one an earlier run created, is used rather than created.
    const existing = databases.find((each) => each.name === databaseName);
    const writeId = async () => {
      const uuid =
        existing?.uuid ?? (await listDatabases()).find((each) => each.name === databaseName)?.uuid;
      if (!uuid) throw new CliError(`wrangler d1 list doesn't list ${databaseName}`);
      setIn(file, [...env.path, 'd1_databases', index, 'database_id'], uuid);
      writeConfig(file);
      context.print(`Wrote its id, ${uuid}, to wrangler.jsonc`);
      // The local database is keyed by database_id, so wrangler dev now starts a new one.
      context.print('Applying the migrations to the local database, which follows the new id…');
      await wranglerOrFail(['d1', 'migrations', 'apply', CHASKI_DB, '--local']);
    };
    steps.push(
      existing
        ? { title: `Use the D1 database ${databaseName}, which already exists`, act: writeId }
        : {
            title: `Create the D1 database ${databaseName}`,
            act: async () => {
              await wranglerOrFail(['d1', 'create', databaseName, '--no-update-config']);
              await writeId();
            },
          },
    );
  }
  for (const queue of missingQueues) {
    steps.push({
      title: `Create the queue ${queue}`,
      act: async () => {
        await wranglerOrFail(['queues', 'create', queue]);
      },
    });
  }
  if (bucket && bucketMissing) {
    steps.push({
      title: `Create the R2 bucket ${bucket}`,
      act: async () => {
        await wranglerOrFail(['r2', 'bucket', 'create', bucket]);
      },
    });
  }

  let url: string | undefined;
  steps.push(
    {
      // Before the deploy: the new code may need the new tables, and migrations only add.
      title: `Apply the migrations to ${databaseName}`,
      act: async () => {
        await wranglerOrFail(['d1', 'migrations', 'apply', CHASKI_DB, '--remote']);
      },
    },
    {
      title:
        secret === 'no worker'
          ? `Deploy the Worker ${env.worker}, with a new CHASKI_SECRET`
          : `Deploy the Worker ${env.worker}`,
      act: async () => {
        const dir = mkdtempSync(join(tmpdir(), 'chaskijs-'));
        const output = join(dir, 'wrangler-output.json');
        const secretsFile = join(dir, 'secrets.json');
        try {
          // A first deploy uploads the secret with the Worker's first version, so it never runs
          // without one. Only then: the file would replace the secret a running Worker holds.
          if (secret === 'no worker') {
            writeFileSync(secretsFile, JSON.stringify({ CHASKI_SECRET: newSecret() }), {
              mode: 0o600,
            });
          }
          const secrets = secret === 'no worker' ? ['--secrets-file', secretsFile] : [];
          await runOrFail(context, 'wrangler', ['deploy', ...secrets, ...envFlags], {
            cwd,
            env: { ...account, WRANGLER_OUTPUT_FILE_PATH: output },
          });
          url = readFileSync(output, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { type?: string; targets?: string[] })
            .find((entry) => entry.type === 'deploy')?.targets?.[0];
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  );
  if (secret === 'missing') {
    steps.push({
      // After the deploy above went through: on a Worker that doesn't exist, `secret put` creates
      // an empty one under its name, which an app could bind to.
      title: 'Set a new CHASKI_SECRET on the Worker',
      act: async () => {
        await wranglerOrFail(['secret', 'put', 'CHASKI_SECRET'], { input: newSecret() });
      },
    });
  }

  context.print();
  context.print(`To deploy ${env.worker}${env.name ? ` (env.${env.name})` : ''}, chaskijs will:`);
  for (const step of steps) context.print(`  ${step.title}`);
  if (!flags.yes) {
    context.print();
    if (!context.interactive) {
      throw new CliError(
        'deploy acts on your Cloudflare account; confirm with --yes when there is no terminal to ask on',
      );
    }
    if (!(await context.prompts.confirm('Go ahead?', false))) {
      context.print('Stopped before any change to your account.');
      return;
    }
  }

  for (const step of steps) {
    context.print();
    context.print(`→ ${step.title}`);
    await step.act();
  }

  context.print();
  context.print(url ? `Chaski is live at ${url}` : `Chaski is deployed as ${env.worker}.`);
  context.print();
  context.print('Two steps are yours:');
  context.print('  1. Turn on Cloudflare Access. In the Cloudflare dashboard, open the');
  context.print(`     Worker ${env.worker}, go to Settings › Domains & Routes and select Enable`);
  context.print('     Cloudflare Access on its workers.dev URL. Use that switch, not the');
  context.print("     Worker's own Access tab: it refuses the dashboard's live updates.");
  context.print(
    url
      ? '  2. Set up the channels on the Channels page, at the URL above.'
      : "  2. Set up the channels on the dashboard's Channels page.",
  );
};
