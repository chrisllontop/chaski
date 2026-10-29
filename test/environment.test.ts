import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflareAccess } from '../src';
import { useConfig } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

// What a host behind Cloudflare Access mounts: no Access in front of wrangler dev, so no token.
const mounted = (environment: string | undefined) => {
  const access = cloudflareAccess({ teamDomain: 'host.cloudflareaccess.com', audience: 'aud' });
  const authorize = vi.fn(access);
  const dashboard = useConfig({ environment }).routes({ dashboard: { authorize } });
  const request = (path: string, init: RequestInit = {}) =>
    dashboard.request(`/api${path}`, { ...init, headers: { origin: 'http://localhost' } }, env);
  return { authorize, request };
};

describe('the local environment', () => {
  // First in the file: the warning goes out once per isolate, and this test sees the first one.
  it('opens the dashboard without authorize, and says so once in the log', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { authorize, request } = mounted('local');

    const first = await request('/channels');
    await request('/channels');

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ environment: 'local', canPause: true });
    expect(authorize).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[chaski:auth]',
      "dashboard open without authorize: the environment is 'local'",
      {},
    );
  });

  it('lets the local actor pause without canPauseChannels', async () => {
    const { request } = mounted('local');

    expect((await request('/channels/email/pause', { method: 'POST' })).status).toBe(200);

    const overview = (await (await request('/channels')).json()) as {
      channels: Array<{ channel: string; paused: unknown }>;
    };
    expect(overview.channels.find((c) => c.channel === 'email')?.paused).toEqual({
      pausedBy: { id: 'local', name: 'Local development' },
      pausedAt: expect.any(String),
    });
  });

  it('needs a publicUrl on localhost, and keeps the dashboard closed without one', async () => {
    const publicUrl = 'https://app.host.test/chaski';
    const chaski = useConfig({ environment: 'local', publicUrl });
    const authorize = vi.fn(() => null);
    const dashboard = chaski.routes({ dashboard: { authorize } });

    await expect(chaski.ready()).rejects.toMatchObject({
      code: 'config',
      message:
        "Chaski config: environment 'local' opens the dashboard without authorize, so publicUrl " +
        'must point at localhost, not app.host.test',
    });
    const response = await dashboard.request('/api/channels', {}, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden', message: 'not allowed' });
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://127.0.0.1:8787/chaski',
    'http://[::1]:8787/chaski',
    'http://app.localhost:5173/chaski',
  ])('takes %s as localhost', async (publicUrl) => {
    await expect(useConfig({ environment: 'local', publicUrl }).ready()).resolves.toMatchObject({
      environment: 'local',
    });
  });
});

describe('a deployed environment', () => {
  it.each([['production'], ['Local'], [''], [undefined]])(
    'asks authorize with %o',
    async (environment) => {
      const { authorize, request } = mounted(environment);

      const response = await request('/channels');

      expect(response.status).toBe(403);
      expect(authorize).toHaveBeenCalledTimes(1);
    },
  );

  it('names itself in ready(), in process and over RPC', async () => {
    const chaski = useConfig({ environment: ' staging ' });

    expect(await chaski.ready()).toMatchObject({ environment: 'staging' });
    expect(await exports.ChaskiEntrypoint.ready()).toMatchObject({ environment: 'staging' });
    expect(await useConfig({ environment: '' }).ready()).toMatchObject({ environment: null });
  });
});
