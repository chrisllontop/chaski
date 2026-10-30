import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { CliError, type Context, runOrFail } from './context';
import { execPrefix, fromUserAgent } from './package-manager';
import { projectFiles } from './scaffold';
import { assertWorkerName } from './wrangler-config';

export type InitFlags = {
  directory?: string;
  folder?: boolean;
  repo?: boolean;
  name?: string;
  email?: boolean;
  attachments?: boolean;
  publicUrl?: string;
  skipInstall?: boolean;
};

export const assertPublicUrl = (url: string, flag = '--public-url') => {
  const parsed = URL.canParse(url) ? new URL(url) : undefined;
  if (parsed?.protocol !== 'https:' && parsed?.protocol !== 'http:') {
    throw new CliError(
      `${flag}: use an absolute http(s) URL, such as https://app.example.com/me/notifications`,
    );
  }
};

// A flag answers first, then the terminal; without one, the default does.
const answer = async <T>(
  context: Context,
  given: T | undefined,
  ask: () => Promise<T>,
  fallback: T,
  check?: (value: T) => void,
): Promise<T> => {
  if (given !== undefined) {
    check?.(given);
    return given;
  }
  if (!context.interactive) return fallback;
  for (;;) {
    const value = await ask();
    try {
      check?.(value);
      return value;
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      context.print(`  ${error.message}`);
    }
  }
};

const gitConfig = async (context: Context, key: string) => {
  const result = await context.run('git', ['config', key], { cwd: context.cwd, capture: true });
  return result.code === 0 ? result.stdout.trim() : '';
};

export const init = async (context: Context, flags: InitFlags) => {
  if (flags.folder && flags.repo) throw new CliError('Pass --folder or --repo, not both');
  let repo = flags.repo ?? (flags.folder ? false : undefined);
  if (repo === undefined) {
    if (!context.interactive) {
      throw new CliError(
        'Say where the project goes: --folder (a folder of this repository) or --repo (a new repository)',
      );
    }
    const choice = await context.prompts.select('Where should the Chaski project live?', [
      'A folder of this repository',
      'A new repository',
    ]);
    repo = choice === 1;
  }

  const directory = await answer(
    context,
    flags.directory,
    () => context.prompts.text('Directory', 'chaski'),
    'chaski',
  );
  const target = resolve(context.cwd, directory);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new CliError(`${directory} isn't empty; init writes a new project into an empty folder`);
  }

  const worker = await answer(
    context,
    flags.name,
    () => context.prompts.text('Worker name', 'chaski'),
    'chaski',
    (value) => assertWorkerName(value, '--name'),
  );
  const email = await answer(
    context,
    flags.email,
    () =>
      context.prompts.confirm(
        'Send email? It needs the Workers Paid plan and a domain on Email Service.',
        true,
      ),
    true,
  );
  if (!email && flags.attachments) {
    throw new CliError('--attachments needs email: attachments go out with emails');
  }
  const attachments =
    email &&
    (await answer(
      context,
      flags.attachments,
      () => context.prompts.confirm('Email attachments? They need an R2 bucket.', false),
      false,
    ));
  const publicUrl =
    (await answer(
      context,
      flags.publicUrl,
      () =>
        context.prompts.text(
          'The URL where your app mounts userRoutes(), for the email open pixel (optional)',
        ),
      '',
      (value) => {
        if (value) assertPublicUrl(value);
      },
    )) || undefined;

  const packageManager = fromUserAgent(context.env.npm_config_user_agent);
  const files = projectFiles({
    worker,
    email,
    attachments,
    publicUrl,
    identity: {
      email: (await gitConfig(context, 'user.email')) || 'you@example.com',
      name: (await gitConfig(context, 'user.name')) || 'You',
    },
    version: context.version,
    packageManager,
  });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    writeFileSync(join(target, path), content);
  }
  const shown = relative(context.cwd, target) || '.';
  context.print();
  context.print(`Created ${shown}/ with ${Object.keys(files).join(', ')}`);

  if (repo) {
    const git = await context.run('git', ['init', '--quiet'], { cwd: target, capture: true });
    context.print(
      git.code === 0
        ? 'Started a Git repository there'
        : `git init failed, so ${shown} isn't a repository yet: ${git.stderr.trim()}`,
    );
  }

  const exec = execPrefix(packageManager);
  const steps = shown === '.' ? [] : [`cd ${shown}`];
  if (flags.skipInstall) {
    steps.push(
      `${packageManager.name} install`,
      `${exec} wrangler d1 migrations apply CHASKI_DB --local`,
    );
  } else {
    context.print();
    context.print(`Installing the dependencies with ${packageManager.name}…`);
    await runOrFail(context, packageManager.name, ['install'], { cwd: target });
    context.print();
    context.print('Applying the migrations to the local database…');
    await runOrFail(context, 'wrangler', ['d1', 'migrations', 'apply', 'CHASKI_DB', '--local'], {
      cwd: target,
    });
  }

  const commands = [
    [`${exec} wrangler dev`, 'Runs it here, the dashboard at http://localhost:8787'],
    [`${exec} chaskijs deploy`, 'Creates its resources in your Cloudflare account and deploys it'],
  ];
  const width = Math.max(...commands.map(([command = '']) => command.length));
  context.print();
  context.print('Next:');
  for (const step of steps) context.print(`  ${step}`);
  for (const [command = '', note] of commands)
    context.print(`  ${command.padEnd(width)}   ${note}`);
};
