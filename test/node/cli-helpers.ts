import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'jsonc-parser';
import { afterEach } from 'vitest';
import type { Context, RunOptions, RunResult } from '../../src/cli/context';
import { projectFiles } from '../../src/cli/scaffold';
import type { WranglerConfig } from '../../src/cli/wrangler-config';

export type Call = { command: string; args: string[]; options: RunOptions };

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

export const tempDir = () => {
  const folder = mkdtempSync(join(tmpdir(), 'chaskijs-cli-'));
  folders.push(folder);
  return folder;
};

export const writeFiles = (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

/** A project as `init` writes it, with the given choices. */
export const project = (options: { attachments?: boolean; email?: boolean } = {}) => {
  const root = tempDir();
  writeFiles(
    root,
    projectFiles({
      worker: 'chaski',
      email: options.email ?? true,
      attachments: options.attachments ?? false,
      identity: { email: 'ana@example.com', name: 'Ana' },
      version: '0.1.0',
      packageManager: { name: 'npm' },
    }),
  );
  return root;
};

export const readConfigAt = (root: string) =>
  parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')) as WranglerConfig;

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });

/**
 * A context whose prompts take the given answers in order, and whose commands go to `respond`,
 * which answers like the real tool; anything it leaves unanswered succeeds silently.
 */
export const fakeContext = ({
  cwd,
  answers = [],
  interactive = true,
  env = {},
  respond = () => undefined,
}: {
  cwd: string;
  answers?: (string | number | boolean)[];
  interactive?: boolean;
  env?: Record<string, string>;
  respond?: (call: Call) => RunResult | undefined | Promise<RunResult | undefined>;
}) => {
  const calls: Call[] = [];
  const output: string[] = [];
  const questions: string[] = [];
  const next = <T>(question: string) => {
    questions.push(question);
    if (!answers.length) throw new Error(`Unexpected question: ${question}`);
    return answers.shift() as T;
  };
  const context: Context = {
    cwd,
    env,
    interactive,
    version: '0.1.0',
    prompts: {
      text: async (question, fallback) => next<string>(question) || fallback || '',
      select: async (question) => next<number>(question),
      confirm: async (question) => next<boolean>(question),
    },
    run: async (command, args, options) => {
      const call = { command, args, options };
      calls.push(call);
      return (await respond(call)) ?? ok();
    },
    print: (line = '') => {
      output.push(line);
    },
  };
  return { context, calls, output, questions };
};

/** A Cloudflare account as Wrangler shows it, which the fake's commands read and change. */
export const fakeAccount = (
  initial: {
    databases?: { uuid: string; name: string }[];
    queues?: string[];
    buckets?: string[];
    secrets?: string[];
    accounts?: { id: string; name: string }[];
    signedIn?: boolean;
  } = {},
) => {
  const account = {
    databases: [...(initial.databases ?? [])],
    queues: new Set(initial.queues ?? []),
    buckets: new Set(initial.buckets ?? []),
    secrets: new Set(initial.secrets ?? []),
    secretValues: [] as string[],
  };
  const respond = ({ command, args, options }: Call): RunResult | undefined => {
    if (command !== 'wrangler') return undefined;
    const [first, , third = '', fourth = ''] = args;
    const exists = (found: boolean) => ({ code: found ? 0 : 1, stdout: '', stderr: '' });
    const is = (...words: string[]) => words.every((word, i) => args[i] === word);
    if (first === 'whoami') {
      return initial.signedIn === false
        ? { code: 1, stdout: '{"loggedIn":false}', stderr: '' }
        : ok(
            JSON.stringify({
              loggedIn: true,
              accounts: initial.accounts ?? [{ id: 'acc1', name: 'Acme' }],
            }),
          );
    }
    if (is('d1', 'list')) return ok(JSON.stringify(account.databases));
    if (is('d1', 'create')) {
      const uuid = `00000000-0000-4000-8000-${String(account.databases.length + 1).padStart(12, '0')}`;
      account.databases.push({ uuid, name: third });
      return ok();
    }
    if (is('queues', 'info')) return exists(account.queues.has(third));
    if (is('queues', 'create')) return ok(void account.queues.add(third));
    if (is('r2', 'bucket', 'info')) return exists(account.buckets.has(fourth));
    if (is('r2', 'bucket', 'create')) return ok(void account.buckets.add(fourth));
    if (first === 'deploy') {
      const output = options.env?.WRANGLER_OUTPUT_FILE_PATH;
      if (output) {
        writeFileSync(
          output,
          `${JSON.stringify({ type: 'wrangler-session', version: 1 })}\n` +
            `${JSON.stringify({ type: 'deploy', targets: ['https://chaski.acme.workers.dev'] })}\n`,
        );
      }
      return ok();
    }
    if (is('secret', 'list')) {
      return ok(
        JSON.stringify([...account.secrets].map((name) => ({ name, type: 'secret_text' }))),
      );
    }
    if (is('secret', 'put')) {
      account.secrets.add(third);
      account.secretValues.push(options.input ?? '');
      return ok();
    }
    return undefined;
  };
  return { account, respond };
};

/** The commands that change something, as `wrangler <args>`, leaving out the ones that only read. */
export const actions = (calls: Call[]) =>
  calls
    .filter(({ command, args }) => {
      if (command !== 'wrangler') return true;
      const line = args.join(' ');
      return !/^(whoami|d1 list|queues info|r2 bucket info|secret list)\b/.test(line);
    })
    .map(({ command, args }) => [command, ...args].join(' '));
