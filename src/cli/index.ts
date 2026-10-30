#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isChaskiError } from '../contract/errors';
import { CliError, type Context } from './context';
import { deploy } from './deploy';
import { envAdd } from './env';
import { init } from './init';
import { terminalPrompts } from './prompts';
import { run } from './runner';
import { templatesToSql } from './templates-sql';
import { sync, upgrade } from './upgrade';

const USAGE = `Usage: chaskijs <command>

  init [directory]       Create a Chaski project
    --folder | --repo      In a folder of this repository, or in a new repository
    --name <worker>        The Worker's name, which its resources are named after (chaski)
    --no-email             Leave email out; it needs the Workers Paid plan and Email Service
    --attachments          Add email attachments, which need an R2 bucket
    --public-url <url>     Where your app mounts userRoutes(), for the email open pixel
    --skip-install         Write the files without installing or creating the local database

  deploy                 Create what the Worker is missing in your Cloudflare account, apply the
                         migrations and deploy, after you confirm
    --env <name>           An environment of wrangler.jsonc
    --yes                  Confirm without asking

  env add <name>         Add an environment to wrangler.jsonc, with resources of its own
    --public-url <url>     Where that environment of your app mounts userRoutes()

  upgrade                Install a new chaskijs and bring the project up to it
    --tag <tag>            An npm dist-tag or version (latest)

  templates sql <file>   Print the SQL that loads a chaski.templates file the way
                         templates().import() does, for wrangler d1 execute --file

https://chaski.sh/docs/install`;

// The bundle is dist/cli.js, next to the package's own package.json one folder up.
const version = () =>
  (
    JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    ) as { version: string }
  ).version;

const templatesSql = async (path: string | undefined) => {
  if (!path) throw new CliError('Name the template file: chaskijs templates sql <file>');
  try {
    const { statements, warnings } = await templatesToSql(JSON.parse(readFileSync(path, 'utf8')));
    for (const warning of warnings) console.error(`warning: ${warning}`);
    process.stdout.write(
      `-- chaski templates from ${path}; run it after Chaski's migrations.\n` +
        statements.map((statement) => `${statement};\n`).join(''),
    );
  } catch (error) {
    throw new CliError(isChaskiError(error) ? error.message : `${path}: ${String(error)}`);
  }
};

const main = async (argv: string[], context: Context) => {
  const [command, ...rest] = argv;
  const parse = <T extends NonNullable<Parameters<typeof parseArgs>[0]>['options']>(options: T) =>
    parseArgs({ args: rest, options, allowPositionals: true, strict: true });

  switch (command) {
    case 'init': {
      const { values, positionals } = parse({
        folder: { type: 'boolean' },
        repo: { type: 'boolean' },
        name: { type: 'string' },
        email: { type: 'boolean' },
        'no-email': { type: 'boolean' },
        attachments: { type: 'boolean' },
        'no-attachments': { type: 'boolean' },
        'public-url': { type: 'string' },
        'skip-install': { type: 'boolean' },
      });
      const either = (yes?: boolean, no?: boolean) => (no ? false : yes ? true : undefined);
      return init(context, {
        directory: positionals[0],
        folder: values.folder,
        repo: values.repo,
        name: values.name,
        email: either(values.email, values['no-email']),
        attachments: either(values.attachments, values['no-attachments']),
        publicUrl: values['public-url'],
        skipInstall: values['skip-install'],
      });
    }
    case 'deploy': {
      const { values } = parse({ env: { type: 'string' }, yes: { type: 'boolean', short: 'y' } });
      return deploy(context, { env: values.env, yes: values.yes });
    }
    case 'env': {
      const { values, positionals } = parse({ 'public-url': { type: 'string' } });
      if (positionals[0] !== 'add') throw new CliError(`Usage: chaskijs env add <name>`);
      return envAdd(context, positionals[1], values['public-url']);
    }
    case 'upgrade': {
      const { values } = parse({ tag: { type: 'string' } });
      return upgrade(context, values.tag);
    }
    // Run by `upgrade` from the chaskijs it just installed, so the new version does the fixing.
    case 'sync':
      parse({});
      return sync(context);
    case 'templates': {
      const { positionals } = parse({});
      if (positionals[0] !== 'sql') throw new CliError(USAGE);
      return templatesSql(positionals[1]);
    }
    case '--version':
    case '-v':
      return context.print(context.version);
    case '--help':
    case '-h':
      return context.print(USAGE);
    default:
      throw new CliError(command ? `Unknown command: ${command}\n\n${USAGE}` : USAGE);
  }
};

const argv = process.argv.slice(2);
const context: Context = {
  cwd: process.cwd(),
  env: process.env,
  interactive: Boolean(process.stdin.isTTY),
  prompts: terminalPrompts,
  run,
  print: (line = '') => process.stdout.write(`${line}\n`),
  version: version(),
};

try {
  if (argv.includes('--help') || argv.includes('-h')) context.print(USAGE);
  else await main(argv, context);
} catch (error) {
  const known =
    error instanceof CliError ||
    (error instanceof TypeError &&
      String((error as NodeJS.ErrnoException).code).startsWith('ERR_PARSE_ARGS'));
  console.error(known ? (error as Error).message : error);
  process.exitCode = 1;
}
