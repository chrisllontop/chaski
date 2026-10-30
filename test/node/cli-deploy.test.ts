import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deploy } from '../../src/cli/deploy';
import { envAdd } from '../../src/cli/env';
import { actions, type Call, fakeAccount, fakeContext, project, readConfigAt } from './cli-helpers';

const PRODUCTION_ID = '0f5b1e2a-6c3d-4e8f-9a0b-1c2d3e4f5a6b';

describe('chaskijs deploy', () => {
  it('creates what is missing, writes the id, migrates, then deploys with a new secret', async () => {
    const root = project({ attachments: true });
    const { account, respond } = fakeAccount();
    // What wrangler.jsonc says when the remote migrations run.
    let idAtMigration: string | undefined;
    const { context, calls, output, questions } = fakeContext({
      cwd: root,
      answers: [true],
      respond: (call: Call) => {
        if (call.args.includes('--remote')) {
          idAtMigration = readConfigAt(root).d1_databases?.[0]?.database_id;
        }
        return respond(call);
      },
    });

    await deploy(context, {});

    expect(questions).toEqual(['Go ahead?']);
    expect(output.slice(0, 10)).toEqual([
      'Checking what chaski needs in your Cloudflare account…',
      '',
      'To deploy chaski, chaskijs will:',
      '  Create the D1 database chaski',
      '  Create the queue chaski-deliveries',
      '  Create the queue chaski-deliveries-dlq',
      '  Create the R2 bucket chaski-attachments',
      '  Apply the migrations to chaski',
      '  Deploy the Worker chaski, with a new CHASKI_SECRET',
      '',
    ]);
    expect(actions(calls)).toEqual([
      'wrangler d1 create chaski --no-update-config',
      // The local database follows database_id, so the new id needs the migrations too.
      'wrangler d1 migrations apply CHASKI_DB --local',
      'wrangler queues create chaski-deliveries',
      'wrangler queues create chaski-deliveries-dlq',
      'wrangler r2 bucket create chaski-attachments',
      'wrangler d1 migrations apply CHASKI_DB --remote',
      // The Worker's first version carries the secret, so it never runs without one.
      'wrangler deploy --secrets-file <file>',
    ]);
    const [created] = account.databases;
    expect(idAtMigration).toBe(created?.uuid);
    expect(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')).toContain(
      '// chaskijs deploy creates the database and writes its id here.',
    );

    const [secret = ''] = account.secretValues;
    expect(Buffer.from(secret, 'base64')).toHaveLength(32);
    expect(output.join('\n')).not.toContain(secret);
    const [file] = account.secretFiles;
    expect(file?.mode).toBe(0o600);
    expect(existsSync(file?.path ?? '')).toBe(false);
    expect(output.slice(-9)).toEqual([
      'Chaski is live at https://chaski.acme.workers.dev',
      '',
      'Two steps are yours, in the Cloudflare dashboard:',
      '  1. Turn on Cloudflare Access. Open the Worker chaski, go to',
      '     Settings › Domains & Routes and select Enable Cloudflare Access on',
      "     its workers.dev URL. Use that switch, not the Worker's own Access",
      "     tab: that one refuses the WebSocket of the dashboard's live updates.",
      "  2. Set up the channels on the dashboard's Channels page:",
      '     https://chaski.acme.workers.dev',
    ]);
  });

  it('only migrates and deploys once everything exists, keeping the secret', async () => {
    const root = project();
    const path = join(root, 'wrangler.jsonc');
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        '"database_id": "local"',
        `"database_id": "${PRODUCTION_ID}"`,
      ),
    );
    const { respond } = fakeAccount({
      databases: [{ uuid: PRODUCTION_ID, name: 'chaski' }],
      queues: ['chaski-deliveries', 'chaski-deliveries-dlq'],
      deployed: true,
      secrets: ['CHASKI_SECRET'],
    });
    const { context, calls } = fakeContext({ cwd: root, interactive: false, respond });

    await deploy(context, { yes: true });

    expect(actions(calls)).toEqual([
      'wrangler d1 migrations apply CHASKI_DB --remote',
      'wrangler deploy',
    ]);
    expect(readConfigAt(root).d1_databases?.[0]?.database_id).toBe(PRODUCTION_ID);
  });

  it('deploys an environment with --env on every command, using a database that already exists', async () => {
    const root = project();
    envAdd(fakeContext({ cwd: root }).context, 'staging');
    const { respond } = fakeAccount({
      databases: [{ uuid: PRODUCTION_ID, name: 'chaski-staging' }],
    });
    const { context, calls, output } = fakeContext({ cwd: root, answers: [true], respond });

    await deploy(context, { env: 'staging' });

    expect(output).toContain('  Use the D1 database chaski-staging, which already exists');
    expect(actions(calls)).toEqual([
      'wrangler d1 migrations apply CHASKI_DB --local --env staging',
      'wrangler queues create chaski-staging-deliveries --env staging',
      'wrangler queues create chaski-staging-deliveries-dlq --env staging',
      'wrangler d1 migrations apply CHASKI_DB --remote --env staging',
      'wrangler deploy --secrets-file <file> --env staging',
    ]);
    expect(
      calls
        .filter((call) => call.args[0] !== 'whoami')
        .every((call) => call.args.includes('staging')),
    ).toBe(true);
    const config = readConfigAt(root);
    expect(config.env?.staging?.d1_databases?.[0]?.database_id).toBe(PRODUCTION_ID);
    expect(config.d1_databases?.[0]?.database_id).toBe('local');
  });

  it('puts the secret after the deploy on a Worker that runs without one', async () => {
    const { account, respond } = fakeAccount({ deployed: true, secrets: ['OTHER'] });
    const { context, calls, output } = fakeContext({ cwd: project(), answers: [true], respond });

    await deploy(context, {});

    expect(output).toContain('  Set a new CHASKI_SECRET on the Worker');
    expect(actions(calls).slice(-2)).toEqual([
      'wrangler deploy',
      'wrangler secret put CHASKI_SECRET',
    ]);
    expect(account.secretFiles).toEqual([]);
    expect(Buffer.from(account.secretValues[0] ?? '', 'base64')).toHaveLength(32);
  });

  // On a Worker that doesn't exist yet, `secret put` creates an empty one under its name.
  it('sets no secret when the deploy fails, and deletes the secrets file', async () => {
    for (const deployed of [false, true]) {
      const { respond } = fakeAccount({ deployed });
      let secretsFile = '';
      const { context, calls } = fakeContext({
        cwd: project(),
        answers: [true],
        respond: (call: Call) => {
          if (call.args[0] !== 'deploy') return respond(call);
          secretsFile = call.args[call.args.indexOf('--secrets-file') + 1] ?? '';
          return { code: 1, stdout: '', stderr: 'Build failed' };
        },
      });

      await expect(deploy(context, {})).rejects.toThrow(/^wrangler deploy( .*)? failed/);
      expect(calls.at(-1)?.args[0]).toBe('deploy');
      expect(calls.some((call) => call.args.join(' ') === 'secret put CHASKI_SECRET')).toBe(false);
      if (!deployed) expect(existsSync(secretsFile)).toBe(false);
    }
  });

  it('stops when Wrangler can’t tell whether the Worker exists', async () => {
    const { respond } = fakeAccount();
    const { context, calls } = fakeContext({
      cwd: project(),
      respond: (call: Call) =>
        call.args.join(' ').startsWith('secret list')
          ? { code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' }
          : respond(call),
    });

    await expect(deploy(context, {})).rejects.toThrow(
      'wrangler secret list failed\nAuthentication error [code: 10000]',
    );
    expect(actions(calls)).toEqual([]);
  });

  it('changes nothing when the user says no', async () => {
    const root = project();
    const before = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
    const { respond } = fakeAccount();
    const { context, calls, output } = fakeContext({ cwd: root, answers: [false], respond });

    await deploy(context, {});

    expect(actions(calls)).toEqual([]);
    expect(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')).toBe(before);
    expect(output.at(-1)).toBe('Stopped before any change to your account.');
  });

  it('asks for --yes when there is no terminal to confirm on', async () => {
    const { respond } = fakeAccount();
    const { context, calls } = fakeContext({ cwd: project(), interactive: false, respond });

    await expect(deploy(context, {})).rejects.toThrow('confirm with --yes');
    expect(actions(calls)).toEqual([]);
  });

  it('asks the user to sign in to Cloudflare first', async () => {
    const { respond } = fakeAccount({ signedIn: false });
    const { context, calls } = fakeContext({ cwd: project(), respond });

    await expect(deploy(context, {})).rejects.toThrow(
      'Sign in to Cloudflare first: npx wrangler login',
    );
    expect(calls.map((call) => call.args.join(' '))).toEqual(['whoami --json']);
  });

  it('asks which account when the login reaches several, and tells Wrangler', async () => {
    const { respond } = fakeAccount({
      accounts: [
        { id: 'acc1', name: 'Personal' },
        { id: 'acc2', name: 'Acme' },
      ],
    });
    const { context, calls, questions } = fakeContext({
      cwd: project(),
      answers: [1, true],
      respond,
    });

    await deploy(context, {});

    expect(questions).toEqual(['Which Cloudflare account gets chaski?', 'Go ahead?']);
    const afterWhoami = calls.slice(1);
    expect(afterWhoami.every((call) => call.options.env?.CLOUDFLARE_ACCOUNT_ID === 'acc2')).toBe(
      true,
    );
  });

  it('names a missing environment and how to add it', async () => {
    const { context } = fakeContext({ cwd: project() });

    await expect(deploy(context, { env: 'staging' })).rejects.toThrow(
      'wrangler.jsonc has no env.staging. Add it with: npx chaskijs env add staging',
    );
  });
});
