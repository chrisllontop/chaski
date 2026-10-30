import { CliError, type Context } from './context';
import { assertPublicUrl } from './init';
import {
  assertWorkerName,
  environmentBlock,
  parseConfig,
  readConfig,
  resourceNames,
  setIn,
  writeConfig,
} from './wrangler-config';

const ENV_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const envAdd = (context: Context, name: string | undefined, publicUrl?: string) => {
  if (!name) throw new CliError('Name the environment: chaskijs env add <name>');
  if (!ENV_NAME.test(name)) {
    throw new CliError(
      `Name the environment with lowercase letters, digits and dashes (got "${name}")`,
    );
  }
  if (publicUrl) assertPublicUrl(publicUrl);
  const file = readConfig(context.cwd);
  const config = parseConfig(file);
  if (config.env?.[name]) throw new CliError(`wrangler.jsonc already has env.${name}`);
  const worker = `${config.name}-${name}`;
  assertWorkerName(worker, 'env add');

  setIn(file, ['env', name], environmentBlock(config, name, publicUrl));
  writeConfig(file);
  const names = resourceNames(worker);
  context.print(
    `Added env.${name} to wrangler.jsonc: the Worker ${worker}, with the database ${names.database} ` +
      `and the queue ${names.queue}.`,
  );
  context.print();
  context.print('Create its resources and deploy it with:');
  context.print(`  npx chaskijs deploy --env ${name}`);
};
