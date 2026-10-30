import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = {
  name: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** The major version, when the user agent names one. */
  major?: number;
};

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
] as const;

/** The one that runs this command, from `npm_config_user_agent` (`pnpm/10.4.1 npm/? node/…`). */
export const fromUserAgent = (userAgent = ''): PackageManager => {
  const [, name, major] = /^(npm|pnpm|yarn|bun)\/(\d+)/.exec(userAgent) ?? [];
  return name ? { name: name as PackageManager['name'], major: Number(major) } : { name: 'npm' };
};

/** A project's own, from its lockfile, since `npx` runs in a pnpm project too. */
export const forProject = (dir: string, userAgent?: string): PackageManager => {
  const lockfile = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
  return lockfile ? { name: lockfile[1] } : fromUserAgent(userAgent);
};

export const addArgs = (pm: PackageManager, spec: string) =>
  pm.name === 'npm' ? ['install', spec] : ['add', spec];

/** How the user runs a package's bin in the project: `npx wrangler dev`, `pnpm wrangler dev`. */
export const execPrefix = (pm: PackageManager) =>
  ({ npm: 'npx', pnpm: 'pnpm', yarn: 'yarn', bun: 'bunx' })[pm.name];
