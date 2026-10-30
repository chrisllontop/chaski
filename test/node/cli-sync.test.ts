import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_DATE,
  DURABLE_OBJECT_CLASSES,
  MAIN_MODULE,
  WORKER_EXPORTS,
} from '../../src/cli/scaffold';
import { migrationsDir, sync, syncConfig, syncMainModule, upgrade } from '../../src/cli/upgrade';
import type { WranglerConfig } from '../../src/cli/wrangler-config';
import { fakeContext, readConfigAt, tempDir, writeFiles } from './cli-helpers';

const repo = join(import.meta.dirname, '../..');

// A project from an older Chaski: four retries, migrations from a copied folder, ChaskiEvents
// bound without a migration, and a staging environment with no retries set.
const OLD_CONFIG = `{
  "name": "chaski",
  "main": "src/index.ts",
  // Production.
  "d1_databases": [
    { "binding": "CHASKI_DB", "database_name": "chaski", "database_id": "local", "migrations_dir": "migrations" }
  ],
  "queues": {
    "producers": [{ "binding": "CHASKI_QUEUE", "queue": "chaski-deliveries" }],
    "consumers": [{ "queue": "chaski-deliveries", "max_retries": 4 }]
  },
  "durable_objects": {
    "bindings": [
      { "name": "CHASKI_FEED", "class_name": "ChaskiFeed" },
      { "name": "CHASKI_EVENTS", "class_name": "ChaskiEvents" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChaskiFeed"] }],
  "env": {
    "staging": {
      // Staging sends from the test domain.
      "d1_databases": [{ "binding": "CHASKI_DB", "database_name": "chaski-staging", "database_id": "local" }],
      "queues": {
        "producers": [{ "binding": "CHASKI_QUEUE", "queue": "chaski-staging-deliveries" }],
        "consumers": [{ "queue": "chaski-staging-deliveries" }]
      },
      "durable_objects": { "bindings": [{ "name": "CHASKI_FEED", "class_name": "ChaskiFeed" }] }
    }
  }
}
`;

const configFile = (text: string) => ({ path: 'wrangler.jsonc', text });

describe('chaskijs sync', () => {
  it('fixes every environment and keeps the comments', () => {
    const file = configFile(OLD_CONFIG);

    const changes = syncConfig(file, 'node_modules/chaskijs/migrations');

    expect(changes).toEqual([
      'Set max_retries to 5 on the consumer of chaski-deliveries',
      'Pointed the migrations_dir of CHASKI_DB at node_modules/chaskijs/migrations',
      'Set max_retries to 5 on the consumer of chaski-staging-deliveries in env.staging',
      'Pointed the migrations_dir of CHASKI_DB at node_modules/chaskijs/migrations in env.staging',
      'Added the Durable Object migration v2 for ChaskiEvents to the top level',
    ]);
    const config = parse(file.text) as WranglerConfig;
    expect(config.queues?.consumers?.[0]?.max_retries).toBe(5);
    expect(config.d1_databases?.[0]?.migrations_dir).toBe('node_modules/chaskijs/migrations');
    expect(config.migrations).toEqual([
      { tag: 'v1', new_sqlite_classes: ['ChaskiFeed'] },
      { tag: 'v2', new_sqlite_classes: ['ChaskiEvents'] },
    ]);
    expect(config.env?.staging?.queues?.consumers?.[0]?.max_retries).toBe(5);
    expect(config.env?.staging?.migrations).toBeUndefined();
    expect(file.text).toContain('// Production.');
    expect(file.text).toContain('// Staging sends from the test domain.');

    expect(syncConfig(file, 'node_modules/chaskijs/migrations')).toEqual([]);
  });

  it('adds a missing class to the migrations of an environment that declares its own', () => {
    const file = configFile(`{
  "name": "chaski",
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChaskiFeed", "ChaskiEvents"] }],
  "env": {
    "staging": {
      "durable_objects": {
        "bindings": [
          { "name": "CHASKI_FEED", "class_name": "ChaskiFeed" },
          { "name": "CHASKI_EVENTS", "class_name": "ChaskiEvents" }
        ]
      },
      "migrations": [
        { "tag": "v1", "new_sqlite_classes": ["ChaskiFeed", "ChaskiEvents"] },
        { "tag": "v2", "deleted_classes": ["ChaskiEvents"] }
      ]
    }
  }
}`);

    expect(syncConfig(file, 'node_modules/chaskijs/migrations')).toEqual([
      'Added the Durable Object migration v3 for ChaskiEvents to env.staging',
    ]);
    const config = parse(file.text) as WranglerConfig;
    expect(config.env?.staging?.migrations?.at(-1)).toEqual({
      tag: 'v3',
      new_sqlite_classes: ['ChaskiEvents'],
    });
  });

  it('gives the main module every export of chaskijs/worker, and only those', () => {
    const old =
      "export { ChaskiEntrypoint, ChaskiFeed, ChaskiScheduler, default } from 'chaskijs/worker';\n";
    const split = [
      "export { default } from 'chaskijs/worker';",
      'export {',
      '  ChaskiEntrypoint,',
      '  ChaskiFeed,',
      "} from 'chaskijs/worker';",
      '',
    ].join('\n');

    expect(syncMainModule(undefined)).toBe(MAIN_MODULE);
    expect(syncMainModule(old)).toBe(MAIN_MODULE);
    expect(syncMainModule(split)).toBe(`${MAIN_MODULE}\n`);
    expect(syncMainModule(MAIN_MODULE)).toBe(MAIN_MODULE);
    expect(syncMainModule("export default { fetch: () => new Response('hi') };\n")).toBeUndefined();
  });

  it('writes the fixes, applies the migrations locally and names each deploy, production last', async () => {
    const root = tempDir();
    writeFiles(root, {
      'wrangler.jsonc': OLD_CONFIG,
      'src/index.ts': "export { ChaskiEntrypoint, ChaskiFeed, default } from 'chaskijs/worker';\n",
      'node_modules/chaskijs/package.json': '{ "name": "chaskijs" }',
    });
    mkdirSync(join(root, 'node_modules/chaskijs/migrations'));
    const { context, calls, output } = fakeContext({ cwd: root });

    await sync(context);

    expect(readConfigAt(root).migrations?.at(-1)?.tag).toBe('v2');
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toBe(MAIN_MODULE);
    expect(output).toContain('Brought the project up to chaskijs 0.1.0:');
    expect(output).toContain(
      '  Rewrote src/index.ts to re-export everything chaskijs/worker exports',
    );
    expect(calls).toEqual([
      {
        command: 'wrangler',
        args: ['d1', 'migrations', 'apply', 'CHASKI_DB', '--local'],
        options: { cwd: root },
      },
    ]);
    expect(output.slice(-3)).toEqual([
      'Deploy each environment, production last:',
      '  npx chaskijs deploy --env staging',
      '  npx chaskijs deploy',
    ]);
  });

  it('points migrations_dir at the chaskijs a workspace hoisted to a parent folder', () => {
    const root = tempDir();
    writeFiles(root, { 'node_modules/chaskijs/package.json': '{ "name": "chaskijs" }' });
    mkdirSync(join(root, 'chaski'));

    expect(migrationsDir(root)).toBe('node_modules/chaskijs/migrations');
    expect(migrationsDir(join(root, 'chaski'))).toBe('../node_modules/chaskijs/migrations');
  });
});

describe('chaskijs upgrade', () => {
  it('installs with the project’s package manager, then syncs with the chaskijs it installed', async () => {
    const root = tempDir();
    writeFiles(root, { 'wrangler.jsonc': OLD_CONFIG, 'pnpm-lock.yaml': '' });
    const { context, calls } = fakeContext({
      cwd: root,
      env: { npm_config_user_agent: 'npm/11.6.0 node/v24.14.0 darwin arm64' },
    });

    await upgrade(context, 'next');

    expect(calls.map(({ command, args }) => [command, ...args].join(' '))).toEqual([
      'pnpm add chaskijs@next',
      'chaskijs sync',
    ]);
  });
});

describe('what the command knows of Chaski', () => {
  it('lists every class chaskijs/worker exports', () => {
    const source = readFileSync(join(repo, 'src/worker/index.ts'), 'utf8');
    const exported = [...source.matchAll(/^export \{([^}]+)\} from/gm)].flatMap(([, list = '']) =>
      list.split(',').map((name) => name.trim()),
    );
    if (/^export default/m.test(source)) exported.push('default');

    expect(WORKER_EXPORTS.toSorted()).toEqual(exported.toSorted());
  });

  it('writes the compatibility date and Durable Objects Chaski’s own tests run with', () => {
    const fixture = parse(
      readFileSync(join(repo, 'test/fixture/wrangler.jsonc'), 'utf8'),
    ) as WranglerConfig & { compatibility_date: string };

    expect(COMPATIBILITY_DATE).toBe(fixture.compatibility_date);
    expect(DURABLE_OBJECT_CLASSES.toSorted()).toEqual(
      fixture.durable_objects?.bindings?.map((binding) => binding.class_name).toSorted(),
    );
  });
});

// A file the sync can't read is the user's to fix, so it stops before changing anything.
describe('a wrangler.jsonc that does not parse', () => {
  it('names the line', () => {
    const root = tempDir();
    writeFileSync(
      join(root, 'wrangler.jsonc'),
      '{\n  "name": "chaski",\n  "main" "src/index.ts"\n}\n',
    );
    const { context } = fakeContext({ cwd: root });

    return expect(sync(context)).rejects.toThrow(/wrangler\.jsonc:3: ColonExpected/);
  });
});
