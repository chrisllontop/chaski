import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { envAdd } from '../../src/cli/env';
import { fakeContext, project, readConfigAt } from './cli-helpers';

const comments = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.trim().startsWith('//'))
    .map((line) => line.trim());

describe('chaskijs env add', () => {
  it('repeats every binding with the environment’s own names, keeping the file’s comments', () => {
    const root = project({ attachments: true });
    const before = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
    const original = readConfigAt(root);
    const { context, output } = fakeContext({ cwd: root });

    envAdd(context, 'staging', 'https://staging.example.com/me/notifications');

    const after = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
    expect(comments(after)).toEqual(comments(before));
    const { env, ...top } = readConfigAt(root);
    expect(top).toEqual(original);
    expect(env).toEqual({
      staging: {
        vars: {
          CHASKI_ENVIRONMENT: 'staging',
          CHASKI_PUBLIC_URL: 'https://staging.example.com/me/notifications',
        },
        d1_databases: [
          {
            binding: 'CHASKI_DB',
            database_name: 'chaski-staging',
            database_id: 'local',
            migrations_dir: 'node_modules/chaskijs/migrations',
          },
        ],
        queues: {
          producers: [{ binding: 'CHASKI_QUEUE', queue: 'chaski-staging-deliveries' }],
          consumers: [
            {
              queue: 'chaski-staging-deliveries',
              max_batch_size: 10,
              max_batch_timeout: 1,
              max_retries: 5,
              dead_letter_queue: 'chaski-staging-deliveries-dlq',
            },
          ],
        },
        durable_objects: {
          bindings: [
            { name: 'CHASKI_FEED', class_name: 'ChaskiFeed' },
            { name: 'CHASKI_EVENTS', class_name: 'ChaskiEvents' },
          ],
        },
        workflows: [
          {
            name: 'chaski-staging-scheduler',
            binding: 'CHASKI_SCHEDULER',
            class_name: 'ChaskiScheduler',
          },
        ],
        r2_buckets: [{ binding: 'CHASKI_ATTACHMENTS', bucket_name: 'chaski-staging-attachments' }],
        send_email: [{ name: 'CHASKI_EMAIL' }],
      },
    });
    expect(output.at(-1)).toBe('  npx chaskijs deploy --env staging');
  });

  it('adds to the environments already there, leaving them and their comments as they are', () => {
    const root = project({ email: false });
    const { context } = fakeContext({ cwd: root });
    envAdd(context, 'staging');
    const path = join(root, 'wrangler.jsonc');
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        '"staging": {',
        '"staging": {\n      // Sends from the test domain.',
      ),
    );

    envAdd(context, 'preview');

    expect(readFileSync(path, 'utf8')).toContain('// Sends from the test domain.');
    const { env } = readConfigAt(root);
    expect(Object.keys(env ?? {})).toEqual(['staging', 'preview']);
    expect(env?.preview?.vars).toEqual({ CHASKI_ENVIRONMENT: 'preview' });
    expect(env?.preview?.send_email).toBeUndefined();
    expect(env?.preview?.r2_buckets).toBeUndefined();
  });

  it('refuses an environment the file already has, or a name its resources can’t take', () => {
    const root = project();
    const { context } = fakeContext({ cwd: root });
    envAdd(context, 'staging');

    expect(() => envAdd(context, 'staging')).toThrow('wrangler.jsonc already has env.staging');
    expect(() => envAdd(context, 'Staging')).toThrow('lowercase letters, digits and dashes');
    expect(() => envAdd(context, 'a'.repeat(50))).toThrow('would pass 63 characters');
  });
});
