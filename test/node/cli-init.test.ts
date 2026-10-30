import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { init } from '../../src/cli/init';
import { MAIN_MODULE } from '../../src/cli/scaffold';
import { fakeContext, readConfigAt, tempDir } from './cli-helpers';

const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

const gitIdentity = ({ command, args }: { command: string; args: string[] }) => {
  if (command !== 'git' || args[0] !== 'config') return undefined;
  const value = { 'user.email': 'ana@example.com', 'user.name': 'Ana Quispe' }[args[1] ?? ''];
  return { code: value ? 0 : 1, stdout: value ? `${value}\n` : '', stderr: '' };
};

describe('chaskijs init', () => {
  it('asks each question and writes a project with the defaults', async () => {
    const cwd = tempDir();
    const { context, calls, questions, output } = fakeContext({
      cwd,
      // A folder of this repository, then the defaults: directory, Worker name, email,
      // attachments and no public URL.
      answers: [0, '', '', true, false, ''],
      respond: gitIdentity,
    });

    await init(context, {});

    expect(questions).toEqual([
      'Where should the Chaski project live?',
      'Directory',
      'Worker name',
      'Send email? It needs the Workers Paid plan and a domain on Email Service.',
      'Email attachments? They need an R2 bucket.',
      'The URL where your app mounts userRoutes(), for the email open pixel (optional)',
    ]);
    const root = join(cwd, 'chaski');
    expect(JSON.parse(read(root, 'package.json'))).toEqual({
      name: 'chaski',
      private: true,
      type: 'module',
      scripts: { dev: 'wrangler dev', deploy: 'chaskijs deploy' },
      dependencies: { chaskijs: '^0.1.0', hono: '^4.8.0' },
      devDependencies: { wrangler: '^4' },
    });
    expect(readConfigAt(root)).toEqual({
      $schema: 'node_modules/wrangler/config-schema.json',
      name: 'chaski',
      main: 'src/index.ts',
      compatibility_date: '2026-10-15',
      observability: { enabled: true },
      vars: { CHASKI_ENVIRONMENT: 'production' },
      access: {
        dev: { aud: 'chaski-local', identity: { email: 'ana@example.com', name: 'Ana Quispe' } },
      },
      d1_databases: [
        {
          binding: 'CHASKI_DB',
          database_name: 'chaski',
          database_id: 'local',
          migrations_dir: 'node_modules/chaskijs/migrations',
        },
      ],
      queues: {
        producers: [{ binding: 'CHASKI_QUEUE', queue: 'chaski-deliveries' }],
        consumers: [
          {
            queue: 'chaski-deliveries',
            max_batch_size: 10,
            max_batch_timeout: 1,
            max_retries: 5,
            dead_letter_queue: 'chaski-deliveries-dlq',
          },
        ],
      },
      durable_objects: {
        bindings: [
          { name: 'CHASKI_FEED', class_name: 'ChaskiFeed' },
          { name: 'CHASKI_EVENTS', class_name: 'ChaskiEvents' },
        ],
      },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['ChaskiFeed', 'ChaskiEvents'] }],
      workflows: [
        { name: 'chaski-scheduler', binding: 'CHASKI_SCHEDULER', class_name: 'ChaskiScheduler' },
      ],
      send_email: [{ name: 'CHASKI_EMAIL' }],
    });
    expect(read(root, 'wrangler.jsonc')).toContain('// Chaski counts on five retries.');
    expect(read(root, 'src/index.ts')).toBe(MAIN_MODULE);
    expect(read(root, '.gitignore')).toBe('node_modules\n.wrangler\n.dev.vars*\n');
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(false);
    const [secret, ...vars] = read(root, '.dev.vars').trimEnd().split('\n');
    expect(Buffer.from(secret?.replace('CHASKI_SECRET=', '') ?? '', 'base64')).toHaveLength(32);
    expect(vars).toEqual(['CHASKI_ENVIRONMENT=local']);

    // Installs, then creates the local database, in the new folder; a folder of this
    // repository starts no repository of its own.
    expect(calls.filter((call) => call.command !== 'git' || call.args[0] !== 'config')).toEqual([
      { command: 'npm', args: ['install'], options: { cwd: root } },
      {
        command: 'wrangler',
        args: ['d1', 'migrations', 'apply', 'CHASKI_DB', '--local'],
        options: { cwd: root },
      },
    ]);
    expect(output.slice(-4)).toEqual([
      'Next:',
      '  cd chaski',
      '  npx wrangler dev      Runs it here, the dashboard at http://localhost:8787',
      '  npx chaskijs deploy   Creates its resources in your Cloudflare account and deploys it',
    ]);
  });

  it('takes every answer from its flag when there is no terminal', async () => {
    const cwd = tempDir();
    const { context, calls, output } = fakeContext({
      cwd,
      interactive: false,
      env: { npm_config_user_agent: 'pnpm/12.15.0 npm/? node/v24.14.0 darwin arm64' },
      respond: ({ command, args }) =>
        command === 'git' && args[0] === 'config' ? { code: 1, stdout: '', stderr: '' } : undefined,
    });

    await init(context, {
      directory: 'notifications',
      repo: true,
      name: 'acme-chaski',
      attachments: true,
      publicUrl: 'https://app.example.com/me/notifications',
      skipInstall: true,
    });

    const root = join(cwd, 'notifications');
    const config = readConfigAt(root);
    expect(config.name).toBe('acme-chaski');
    expect(config.vars).toEqual({
      CHASKI_ENVIRONMENT: 'production',
      CHASKI_PUBLIC_URL: 'https://app.example.com/me/notifications',
    });
    expect(config.d1_databases?.[0]?.database_name).toBe('acme-chaski');
    expect(config.queues?.consumers?.[0]).toMatchObject({
      queue: 'acme-chaski-deliveries',
      dead_letter_queue: 'acme-chaski-deliveries-dlq',
    });
    expect(config.workflows?.[0]?.name).toBe('acme-chaski-scheduler');
    expect(config.r2_buckets).toEqual([
      { binding: 'CHASKI_ATTACHMENTS', bucket_name: 'acme-chaski-attachments' },
    ]);
    expect(config.send_email).toEqual([{ name: 'CHASKI_EMAIL' }]);
    // Without a Git identity, wrangler dev signs in a placeholder.
    expect((config as { access?: unknown }).access).toEqual({
      dev: { aud: 'chaski-local', identity: { email: 'you@example.com', name: 'You' } },
    });
    expect(read(root, '.dev.vars')).toContain(
      '\nCHASKI_PUBLIC_URL=https://app.example.com/me/notifications\n',
    );
    // pnpm runs the build scripts of Wrangler's workerd and esbuild only once allowed.
    expect(read(root, 'pnpm-workspace.yaml')).toBe(
      'allowBuilds:\n  esbuild: true\n  workerd: true\n',
    );

    // A new repository; no install, so the next steps say how.
    expect(calls.filter((call) => call.command !== 'git' || call.args[0] !== 'config')).toEqual([
      { command: 'git', args: ['init', '--quiet'], options: { cwd: root, capture: true } },
    ]);
    expect(output.slice(-6)).toEqual([
      'Next:',
      '  cd notifications',
      '  pnpm install',
      '  pnpm wrangler d1 migrations apply CHASKI_DB --local',
      '  pnpm wrangler dev      Runs it here, the dashboard at http://localhost:8787',
      '  pnpm chaskijs deploy   Creates its resources in your Cloudflare account and deploys it',
    ]);
  });

  it('declares no email binding without email', async () => {
    const cwd = tempDir();
    const { context } = fakeContext({ cwd, interactive: false });

    await init(context, { folder: true, email: false, skipInstall: true });

    const config = readConfigAt(join(cwd, 'chaski'));
    expect(config.send_email).toBeUndefined();
    expect(config.r2_buckets).toBeUndefined();
  });

  it('tells Yarn 2 and later to install into node_modules, where Wrangler reads the migrations', async () => {
    const cwd = tempDir();
    const { context } = fakeContext({
      cwd,
      interactive: false,
      env: { npm_config_user_agent: 'yarn/4.9.1 npm/? node/v24.14.0 darwin arm64' },
    });

    await init(context, { folder: true, skipInstall: true });

    expect(read(join(cwd, 'chaski'), '.yarnrc.yml')).toBe('nodeLinker: node-modules\n');
  });

  it('names --folder and --repo when there is no terminal to ask where the project goes', async () => {
    const cwd = tempDir();
    const { context } = fakeContext({ cwd, interactive: false });

    await expect(init(context, {})).rejects.toThrow(/--folder .* --repo/);
    expect(existsSync(join(cwd, 'chaski'))).toBe(false);
  });

  it('refuses to write into a folder that holds anything', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, 'chaski'));
    writeFileSync(join(cwd, 'chaski', 'notes.md'), 'mine');
    const { context } = fakeContext({ cwd, interactive: false });

    await expect(init(context, { folder: true })).rejects.toThrow("chaski isn't empty");
    expect(read(join(cwd, 'chaski'), 'notes.md')).toBe('mine');
  });

  it('asks again for a Worker name it can name the resources after', async () => {
    const cwd = tempDir();
    const { context, output } = fakeContext({
      cwd,
      answers: [1, 'svc', 'Acme Chaski', 'acme', false, ''],
    });

    await init(context, { skipInstall: true });

    expect(output[0]).toBe(
      '  --name: use lowercase letters, digits and dashes (got "Acme Chaski")',
    );
    expect(readConfigAt(join(cwd, 'svc')).name).toBe('acme');
  });

  it('refuses attachments without email, and a public URL that is not absolute', async () => {
    const { context } = fakeContext({ cwd: tempDir(), interactive: false });

    await expect(init(context, { folder: true, email: false, attachments: true })).rejects.toThrow(
      '--attachments needs email',
    );
    await expect(init(context, { folder: true, publicUrl: '/me/notifications' })).rejects.toThrow(
      '--public-url: use an absolute http(s) URL',
    );
  });
});
