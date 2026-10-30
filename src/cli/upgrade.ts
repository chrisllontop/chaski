import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { type Context, runOrFail } from './context';
import { addArgs, forProject } from './package-manager';
import { findPackage } from './runner';
import { DURABLE_OBJECT_CLASSES, MAIN_MODULE, MIGRATIONS_DIR, WORKER_EXPORTS } from './scaffold';
import {
  CHASKI_DB,
  CHASKI_QUEUE,
  type ConfigFile,
  environments,
  label,
  migratedClasses,
  nextMigrationTag,
  parseConfig,
  readConfig,
  setIn,
  writeConfig,
} from './wrangler-config';

/** Installs chaskijs, then has the copy it installed bring the project up to that version. */
export const upgrade = async (context: Context, tag = 'latest') => {
  const cwd = dirname(readConfig(context.cwd).path);
  const packageManager = forProject(cwd, context.env.npm_config_user_agent);
  context.print(`Installing chaskijs@${tag} with ${packageManager.name}…`);
  await runOrFail(context, packageManager.name, addArgs(packageManager, `chaskijs@${tag}`), {
    cwd,
  });
  context.print();
  await runOrFail(context, 'chaskijs', ['sync'], { cwd });
};

/** Where the installed chaskijs keeps its migrations, from the project's folder. */
export const migrationsDir = (cwd: string) => {
  const root = findPackage(cwd, 'chaskijs');
  return root ? relative(cwd, join(root, 'migrations')).split(sep).join('/') : MIGRATIONS_DIR;
};

/**
 * Brings every environment of wrangler.jsonc to what this version of Chaski needs, in place, and
 * says what it changed.
 */
export const syncConfig = (file: ConfigFile, wantedMigrationsDir: string) => {
  const changes: string[] = [];
  for (const env of environments(parseConfig(file))) {
    const where = env.name ? ` in env.${env.name}` : '';
    const queue = env.scope.queues?.producers?.find((each) => each.binding === CHASKI_QUEUE)?.queue;
    env.scope.queues?.consumers?.forEach((consumer, index) => {
      if (consumer.queue !== queue || consumer.max_retries === 5) return;
      setIn(file, [...env.path, 'queues', 'consumers', index, 'max_retries'], 5);
      changes.push(`Set max_retries to 5 on the consumer of ${queue}${where}`);
    });
    env.scope.d1_databases?.forEach((database, index) => {
      if (database.binding !== CHASKI_DB || database.migrations_dir === wantedMigrationsDir) return;
      setIn(file, [...env.path, 'd1_databases', index, 'migrations_dir'], wantedMigrationsDir);
      changes.push(`Pointed the migrations_dir of CHASKI_DB at ${wantedMigrationsDir}${where}`);
    });
  }

  // Environments take the top level's Durable Object migrations unless they declare their own,
  // and an entry added to the top level shows in the next environment, so each reads it afresh.
  for (const { name } of environments(parseConfig(file))) {
    const config = parseConfig(file);
    const env = environments(config).find((each) => each.name === name);
    if (!env) continue;
    const owner = env.scope.migrations ? env : environments(config)[0];
    if (!owner) continue;
    const created = migratedClasses(owner.scope.migrations);
    const bound = new Set(
      (env.scope.durable_objects?.bindings ?? [])
        .filter((binding) => !binding.script_name)
        .map((binding) => binding.class_name),
    );
    const missing = DURABLE_OBJECT_CLASSES.filter((each) => bound.has(each) && !created.has(each));
    if (!missing.length) continue;
    const tag = nextMigrationTag(owner.scope.migrations);
    setIn(file, [...owner.path, 'migrations', owner.scope.migrations?.length ?? 0], {
      tag,
      new_sqlite_classes: missing,
    });
    changes.push(
      `Added the Durable Object migration ${tag} for ${missing.join(' and ')} to ${label(owner)}`,
    );
  }
  return changes;
};

const EXPORTS = /export\s*\{([^}]*)\}\s*from\s*(['"])chaskijs\/worker\2\s*;?/g;

/**
 * The main module with every export of `chaskijs/worker` and no other, or undefined when it doesn't
 * re-export `chaskijs/worker` at all, which only its author can sort out.
 */
export const syncMainModule = (source: string | undefined) => {
  if (source === undefined) return MAIN_MODULE;
  const statements = [...source.matchAll(EXPORTS)];
  if (!statements.length) return undefined;
  const names = new Set(
    statements.flatMap(([, list = '']) =>
      list
        .split(',')
        .map(
          (each) =>
            each
              .trim()
              .split(/\s+as\s+/)
              .pop() ?? '',
        )
        .filter(Boolean),
    ),
  );
  if (names.size === WORKER_EXPORTS.length && WORKER_EXPORTS.every((each) => names.has(each))) {
    return source;
  }
  let first = true;
  return source.replace(EXPORTS, () => {
    if (!first) return '';
    first = false;
    return MAIN_MODULE.trimEnd();
  });
};

export const sync = async (context: Context) => {
  const file = readConfig(context.cwd);
  const cwd = dirname(file.path);
  const changes = syncConfig(file, migrationsDir(cwd));
  if (changes.length) writeConfig(file);

  const config = parseConfig(file);
  const main = config.main ?? 'src/index.ts';
  const mainPath = join(cwd, main);
  const source = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : undefined;
  const next = syncMainModule(source);
  if (next === undefined) {
    changes.push(`${main} doesn't re-export chaskijs/worker; it needs: ${MAIN_MODULE.trimEnd()}`);
  } else if (next !== source) {
    writeFileSync(mainPath, next);
    changes.push(`Rewrote ${main} to re-export everything chaskijs/worker exports`);
  }

  context.print(
    changes.length
      ? `Brought the project up to chaskijs ${context.version}:`
      : `The project already matches chaskijs ${context.version}.`,
  );
  for (const change of changes) context.print(`  ${change}`);
  context.print();
  context.print('Applying the migrations to the local database…');
  await runOrFail(context, 'wrangler', ['d1', 'migrations', 'apply', CHASKI_DB, '--local'], {
    cwd,
  });

  // Staging and the rest go first, so production gets the version they already run.
  const deploys = environments(config)
    .reverse()
    .map((env) => `npx chaskijs deploy${env.name ? ` --env ${env.name}` : ''}`);
  context.print();
  context.print(deploys.length > 1 ? 'Deploy each environment, production last:' : 'Deploy it:');
  for (const command of deploys) context.print(`  ${command}`);
};
