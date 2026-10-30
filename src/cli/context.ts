/** A failure the user can act on: the command prints its message alone, without a stack. */
export class CliError extends Error {
  override name = 'CliError';
}

export type RunOptions = {
  cwd: string;
  /** Written to the command's stdin; without it, stdin is closed. */
  input?: string;
  /** Collects stdout and stderr instead of showing them. */
  capture?: boolean;
  env?: Record<string, string>;
};

export type RunResult = { code: number; stdout: string; stderr: string };

/**
 * Runs `wrangler`, `chaskijs` (the copy installed in the project), `git`, `node` or a package
 * manager. Its stdin is never a terminal, so Wrangler doesn't stop to ask: the commands that act on
 * the account run only after the user said yes to the whole plan.
 */
export type Run = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

export type Prompts = {
  text: (question: string, fallback?: string) => Promise<string>;
  /** The index of the choice; there's no default, so it asks until it gets one. */
  select: (question: string, choices: string[]) => Promise<number>;
  confirm: (question: string, fallback: boolean) => Promise<boolean>;
};

export type Context = {
  cwd: string;
  env: Record<string, string | undefined>;
  /** Whether stdin is a terminal the prompts can ask on. */
  interactive: boolean;
  prompts: Prompts;
  run: Run;
  print: (line?: string) => void;
  /** The version of this `chaskijs`, which `init` writes into the project. */
  version: string;
};

export const runOrFail = async (
  context: Context,
  command: string,
  args: string[],
  options: RunOptions,
) => {
  const result = await context.run(command, args, options);
  if (result.code !== 0) {
    const detail = options.capture ? `\n${(result.stderr || result.stdout).trim()}` : '';
    throw new CliError(`${[command, ...args].join(' ')} failed${detail}`);
  }
  return result;
};
