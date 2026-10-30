import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CliError, type Run } from './context';

const isWindows = process.platform === 'win32';

/** The folder of a package installed for `dir`, looking up through the parent `node_modules`. */
export const findPackage = (dir: string, name: string): string | undefined => {
  for (let at = dir; ; at = dirname(at)) {
    const candidate = join(at, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(at) === at) return undefined;
  }
};

// Running a package's bin script with Node itself skips the `.cmd` shims Windows puts in
// node_modules/.bin, which Node only spawns through a shell.
const binScript = (dir: string, name: string): string | undefined => {
  const root = findPackage(dir, name);
  if (!root) return undefined;
  const { bin } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const script = typeof bin === 'string' ? bin : bin?.[name];
  return script ? join(root, script) : undefined;
};

// cmd.exe reads `^`, `&` and the like unless they're quoted.
const quote = (arg: string) =>
  /^[\w@./:=-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`;

const resolve = (command: string, args: string[], cwd: string) => {
  if (command === 'node') return { file: process.execPath, args, shell: false };
  if (command === 'wrangler' || command === 'chaskijs') {
    const script = binScript(cwd, command);
    if (script) return { file: process.execPath, args: [script, ...args], shell: false };
    // The project's own chaskijs is the point: another version would apply other fixes.
    if (command === 'chaskijs') throw new CliError(`chaskijs isn't installed in ${cwd}`);
    return resolve('npx', ['--yes', 'wrangler', ...args], cwd);
  }
  // npm, npx, pnpm and yarn are `.cmd` shims on Windows.
  return isWindows
    ? { file: [command, ...args].map(quote).join(' '), args: [], shell: true }
    : { file: command, args, shell: false };
};

export const run: Run = (command, args, { cwd, input, capture, env }) =>
  new Promise((done, fail) => {
    const target = resolve(command, args, cwd);
    const child = spawn(target.file, target.args, {
      cwd,
      env: { ...process.env, ...env },
      shell: target.shell,
      stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    // stderr is collected either way, so a failure can say why, and shown as it comes unless
    // the caller captures.
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (!capture) process.stderr.write(chunk);
    });
    child.stdin?.end(input);
    child.on('error', (error) =>
      fail(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new CliError(`${command} isn't installed, or isn't on your PATH`)
          : error,
      ),
    );
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });
