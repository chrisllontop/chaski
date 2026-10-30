import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api as chaski } from '../src/server/api';
import { configFromEnv, validateConfig } from '../src/server/config';
import { fixtureConfig } from './fixture/worker';
import { useConfig } from './helpers';

describe('config', () => {
  it('reads the bindings under the names wrangler.jsonc gives them', () => {
    expect(configFromEnv(env).bindings).toEqual({
      db: env.CHASKI_DB,
      queue: env.CHASKI_QUEUE,
      email: env.CHASKI_EMAIL,
      events: env.CHASKI_EVENTS,
      scheduler: env.CHASKI_SCHEDULER,
      feed: env.CHASKI_FEED,
      attachments: env.CHASKI_ATTACHMENTS,
    });
  });

  it.each([
    ['db', 'CHASKI_DB'],
    ['queue', 'CHASKI_QUEUE'],
  ] as const)('names a missing %s binding as wrangler.jsonc does', (key, name) => {
    const config = fixtureConfig(env);
    expect(() =>
      validateConfig({ ...config, bindings: { ...config.bindings, [key]: undefined } }),
    ).toThrowError(
      expect.objectContaining({
        code: 'config',
        message: `Chaski config: the ${name} binding is missing`,
      }),
    );
  });

  it('requires the email binding once the email channel is configured', () => {
    const config = fixtureConfig(env);
    expect(() =>
      validateConfig({ ...config, bindings: { ...config.bindings, email: undefined } }),
    ).toThrowError(
      expect.objectContaining({
        message:
          'Chaski config: channels.email is configured but the CHASKI_EMAIL binding is missing',
      }),
    );
  });

  it('requires the feed binding once the in_app channel is configured', () => {
    const config = fixtureConfig(env);
    expect(() =>
      validateConfig({ ...config, bindings: { ...config.bindings, feed: undefined } }),
    ).toThrowError(
      expect.objectContaining({
        message:
          'Chaski config: channels.in_app is configured but the CHASKI_FEED binding is missing',
      }),
    );
  });

  it('takes no publicUrl, and only an absolute one', () => {
    expect(validateConfig({ ...fixtureConfig(env), publicUrl: undefined }).publicUrl).toBeNull();
    expect(
      validateConfig({ ...fixtureConfig(env), publicUrl: 'https://app.test/notifications/' })
        .publicUrl,
    ).toBe('https://app.test/notifications');
    expect(() =>
      validateConfig({ ...fixtureConfig(env), publicUrl: '/notifications' }),
    ).toThrowError(
      expect.objectContaining({
        code: 'config',
        message: expect.stringContaining('CHASKI_PUBLIC_URL must be the absolute http(s) URL'),
      }),
    );
  });

  it('lists only the channels that have config', () => {
    const config = fixtureConfig(env);
    expect(validateConfig(config).enabledChannels).toEqual(['email', 'in_app']);
    expect(validateConfig({ ...config, channels: {} }).enabledChannels).toEqual([]);
  });
});

describe('the environment', () => {
  it('names itself in ready(), in process and over RPC', async () => {
    useConfig({ environment: ' staging ' });

    expect(await chaski.ready()).toMatchObject({ environment: 'staging' });
    expect(await exports.ChaskiEntrypoint.ready()).toMatchObject({ environment: 'staging' });
    useConfig({ environment: '' });
    expect(await chaski.ready()).toMatchObject({ environment: null });
  });
});
