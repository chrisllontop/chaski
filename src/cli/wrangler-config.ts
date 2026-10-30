import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyEdits, modify, type ParseError, parse, printParseErrorCode } from 'jsonc-parser';
import { CliError } from './context';

type D1Database = {
  binding: string;
  database_name?: string;
  database_id?: string;
  migrations_dir?: string;
};
type Consumer = {
  queue: string;
  max_batch_size?: number;
  max_batch_timeout?: number;
  max_retries?: number;
  dead_letter_queue?: string;
};
type Migration = {
  tag: string;
  new_classes?: string[];
  new_sqlite_classes?: string[];
  renamed_classes?: { from: string; to: string }[];
  deleted_classes?: string[];
  transferred_classes?: { to: string }[];
};

/** What Chaski reads of a Worker's config: the top level, or one `env` block. */
export type Scope = {
  name?: string;
  main?: string;
  account_id?: string;
  vars?: Record<string, unknown>;
  d1_databases?: D1Database[];
  queues?: { producers?: { binding: string; queue: string }[]; consumers?: Consumer[] };
  durable_objects?: { bindings?: { name: string; class_name: string; script_name?: string }[] };
  migrations?: Migration[];
  workflows?: { name: string; binding: string; class_name: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  send_email?: { name: string }[];
};

export type WranglerConfig = Scope & { name: string; env?: Record<string, Scope> };

/** One deployable Worker of the project: the top level is production, each `env` block another. */
export type Environment = {
  /** Undefined for the top level. */
  name: string | undefined;
  /** Where its block sits in the file. */
  path: string[];
  scope: Scope;
  /** Wrangler names an environment's Worker `<name>-<env>` unless the block names it. */
  worker: string;
};

export const CHASKI_DB = 'CHASKI_DB';
export const CHASKI_QUEUE = 'CHASKI_QUEUE';
export const CHASKI_ATTACHMENTS = 'CHASKI_ATTACHMENTS';

const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Queue and R2 bucket names stop at 63 characters.
const MAX_RESOURCE_NAME = 63;

/** The names `init` and `env add` give an environment's resources, after its Worker. */
export const resourceNames = (worker: string) => ({
  database: worker,
  queue: `${worker}-deliveries`,
  deadLetterQueue: `${worker}-deliveries-dlq`,
  workflow: `${worker}-scheduler`,
  bucket: `${worker}-attachments`,
});

export const assertWorkerName = (worker: string, flag: string) => {
  if (!NAME.test(worker)) {
    throw new CliError(`${flag}: use lowercase letters, digits and dashes (got "${worker}")`);
  }
  const longest = resourceNames(worker).deadLetterQueue;
  if (longest.length > MAX_RESOURCE_NAME) {
    throw new CliError(
      `${flag}: "${worker}" is too long; its queue ${longest} would pass ${MAX_RESOURCE_NAME} characters`,
    );
  }
};

export type ConfigFile = { path: string; text: string };

export const readConfig = (dir: string): ConfigFile => {
  for (const file of ['wrangler.jsonc', 'wrangler.json']) {
    const path = join(dir, file);
    if (existsSync(path)) return { path, text: readFileSync(path, 'utf8') };
  }
  const toml = existsSync(join(dir, 'wrangler.toml'));
  throw new CliError(
    toml
      ? 'chaskijs reads wrangler.jsonc or wrangler.json, and this project has wrangler.toml'
      : `No wrangler.jsonc in ${dir}. Run this in a Chaski project, or create one with: npx chaskijs init`,
  );
};

export const parseConfig = (file: ConfigFile): WranglerConfig => {
  const errors: ParseError[] = [];
  const config = parse(file.text, errors, { allowTrailingComma: true }) as WranglerConfig;
  const [error] = errors;
  if (error) {
    const line = file.text.slice(0, error.offset).split('\n').length;
    throw new CliError(`${file.path}:${line}: ${printParseErrorCode(error.error)}`);
  }
  if (typeof config?.name !== 'string') throw new CliError(`${file.path} names no Worker`);
  return config;
};

/** Sets one value in place, keeping the rest of the file, its comments included, as it is. */
export const setIn = (file: ConfigFile, path: (string | number)[], value: unknown) => {
  const edits = modify(file.text, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
  });
  file.text = applyEdits(file.text, edits);
};

export const writeConfig = (file: ConfigFile) => writeFileSync(file.path, file.text);

export const environments = (config: WranglerConfig): Environment[] => [
  { name: undefined, path: [], scope: config, worker: config.name },
  ...Object.entries(config.env ?? {}).map(([name, scope]) => ({
    name,
    path: ['env', name],
    scope,
    worker: scope.name ?? `${config.name}-${name}`,
  })),
];

export const environment = (config: WranglerConfig, name: string | undefined) => {
  const found = environments(config).find((each) => each.name === name);
  if (!found) {
    throw new CliError(
      `wrangler.jsonc has no env.${name}. Add it with: npx chaskijs env add ${name}`,
    );
  }
  return found;
};

export const label = (env: Environment) => (env.name ? `env.${env.name}` : 'the top level');

/** The `--env` flag Wrangler takes for this environment, if any. */
export const envArgs = (env: Environment) => (env.name ? ['--env', env.name] : []);

export const databaseIndex = (scope: Scope) =>
  scope.d1_databases?.findIndex((database) => database.binding === CHASKI_DB) ?? -1;

/** Every queue the environment declares: producers, consumers and dead-letter queues. */
export const declaredQueues = (scope: Scope) => [
  ...new Set([
    ...(scope.queues?.producers ?? []).map((producer) => producer.queue),
    ...(scope.queues?.consumers ?? []).flatMap((consumer) =>
      consumer.dead_letter_queue ? [consumer.queue, consumer.dead_letter_queue] : [consumer.queue],
    ),
  ]),
];

export const attachmentsBucket = (scope: Scope) =>
  scope.r2_buckets?.find((bucket) => bucket.binding === CHASKI_ATTACHMENTS)?.bucket_name;

/** The Durable Object classes a list of migrations has created and not deleted since. */
export const migratedClasses = (migrations: Migration[] = []) => {
  const classes = new Set<string>();
  for (const migration of migrations) {
    for (const name of [
      ...(migration.new_classes ?? []),
      ...(migration.new_sqlite_classes ?? []),
    ]) {
      classes.add(name);
    }
    for (const { from, to } of migration.renamed_classes ?? []) {
      classes.delete(from);
      classes.add(to);
    }
    for (const { to } of migration.transferred_classes ?? []) classes.add(to);
    for (const name of migration.deleted_classes ?? []) classes.delete(name);
  }
  return classes;
};

/** A tag after every one the list holds: `v2` after `v1`. */
export const nextMigrationTag = (migrations: Migration[] = []) => {
  const tags = new Set(migrations.map((migration) => migration.tag));
  let next = Math.max(0, ...[...tags].map((tag) => Number(/^v(\d+)$/.exec(tag)?.[1] ?? 0))) + 1;
  while (tags.has(`v${next}`)) next += 1;
  return `v${next}`;
};

/**
 * An `env` block for `name`, repeating each Chaski binding the top level declares with the
 * environment's own resources, since Wrangler carries neither bindings nor vars into an
 * environment. The Durable Object migrations do carry over, so the block leaves them out.
 */
export const environmentBlock = (config: WranglerConfig, name: string, publicUrl?: string) => {
  const names = resourceNames(`${config.name}-${name}`);
  const block: Scope = {
    vars: { CHASKI_ENVIRONMENT: name, ...(publicUrl ? { CHASKI_PUBLIC_URL: publicUrl } : {}) },
  };
  const database = config.d1_databases?.find((each) => each.binding === CHASKI_DB);
  if (database) {
    block.d1_databases = [
      {
        binding: CHASKI_DB,
        database_name: names.database,
        database_id: 'local',
        ...(database.migrations_dir ? { migrations_dir: database.migrations_dir } : {}),
      },
    ];
  }
  const producer = config.queues?.producers?.find((each) => each.binding === CHASKI_QUEUE);
  if (producer) {
    const consumer = config.queues?.consumers?.find((each) => each.queue === producer.queue);
    block.queues = {
      producers: [{ binding: CHASKI_QUEUE, queue: names.queue }],
      ...(consumer
        ? {
            consumers: [
              {
                ...consumer,
                queue: names.queue,
                ...(consumer.dead_letter_queue ? { dead_letter_queue: names.deadLetterQueue } : {}),
              },
            ],
          }
        : {}),
    };
  }
  if (config.durable_objects?.bindings?.length) {
    block.durable_objects = { bindings: config.durable_objects.bindings };
  }
  if (config.workflows?.length) {
    block.workflows = config.workflows.map((workflow) => ({ ...workflow, name: names.workflow }));
  }
  if (attachmentsBucket(config)) {
    block.r2_buckets = [{ binding: CHASKI_ATTACHMENTS, bucket_name: names.bucket }];
  }
  if (config.send_email?.length) block.send_email = config.send_email;
  return block;
};
