import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  introspectWorkflow,
} from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECIPIENT_HEADER } from '../src/contract/api';
import { api as chaski } from '../src/server/api';
import {
  type ChaskiConfig,
  resolveConfig,
  setStoredSettings,
  validateConfig,
} from '../src/server/config';
import { getClient } from '../src/server/db';
import { encodeBase64Url } from '../src/server/lib/base64';
import { ScheduleService } from '../src/server/services/schedule.service';
import worker from '../src/worker';
import { fixtureConfig } from './fixture/worker';
import {
  api,
  processDeliveries,
  queuedMessages,
  recipient,
  seedTemplate,
  signedIn,
  stubEmail,
  useConfig,
} from './helpers';

const put = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  api(path, { method: 'PUT', body: JSON.stringify(body), headers });

const post = (path: string, body: unknown = {}) =>
  api(path, { method: 'POST', body: JSON.stringify(body) });

const remove = (path: string) => api(path, { method: 'DELETE' });

// A deployed Chaski turns nothing on from code: every channel comes from the settings saved here.
const asDeployed = (overrides: Partial<ChaskiConfig> = {}) =>
  useConfig({ channels: {}, ...overrides });

const p256 = async () =>
  (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

const vapidKeys = async () => {
  const pair = await p256();
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: encodeBase64Url(new Uint8Array(raw)), privateKey: jwk.d ?? '' };
};

const pemBody = (der: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(der)));
const pem = (body: string) => `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;

const vapid = { subject: 'mailto:ops@host.test', ...(await vapidKeys()) };

const p8Body = pemBody(
  (await crypto.subtle.exportKey('pkcs8', (await p256()).privateKey)) as ArrayBuffer,
);
const apns = {
  teamId: 'TEAM123456',
  keyId: 'KEY1234567',
  privateKey: pem(p8Body),
  ios: { bundleId: 'com.host.app', environment: 'sandbox' },
};

const rsa = (await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const fcmKeyBody = pemBody((await crypto.subtle.exportKey('pkcs8', rsa.privateKey)) as ArrayBuffer);
const serviceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'host-app',
  private_key_id: 'key-1',
  private_key: pem(fcmKeyBody),
  client_email: 'chaski@host-app.iam.gserviceaccount.com',
});

const wns = { tenantId: 'tenant-1', clientId: 'client-1', clientSecret: 'wns-client-secret-0042' };

const SECRETS = [vapid.privateKey, p8Body, fcmKeyBody, wns.clientSecret];

type Saved = Record<string, unknown> & { problem: string | null };
type Overview = {
  secret: string;
  bindings: { email: boolean; feed: boolean };
  channels: Array<{
    channel: string;
    enabled: boolean;
    settings?: Saved | null;
    providers?: Record<string, Saved | null>;
  }>;
};

const overview = async () => {
  const response = await api('/channels');
  expect(response.status).toBe(200);
  return (await response.json()) as Overview;
};

const channelOf = (data: Overview, channel: string) =>
  data.channels.find((entry) => entry.channel === channel);

const providerOf = async (provider: string) =>
  channelOf(await overview(), 'push')?.providers?.[provider];

const saveAll = async () => {
  for (const [path, body] of [
    ['/channels/email', { from: 'hello@host.test' }],
    ['/channels/in_app', {}],
    ['/channels/push/vapid', vapid],
    ['/channels/push/apns', apns],
    ['/channels/push/fcm', { serviceAccount }],
    ['/channels/push/wns', wns],
  ] as const) {
    expect((await put(path, body)).status).toBe(200);
  }
};

const settingsRow = (section: string) =>
  env.CHASKI_DB.prepare('SELECT * FROM settings WHERE section = ?')
    .bind(section)
    .first<{ value: string; secret: string | null }>();

// Another isolate's change: this one's settings stay as they were until its next request.
const deleteElsewhere = (section: string) =>
  env.CHASKI_DB.prepare('DELETE FROM settings WHERE section = ?').bind(section).run();

const browserSubscription = async (endpoint: string) => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  return {
    endpoint,
    keys: {
      p256dh: encodeBase64Url(new Uint8Array(raw)),
      auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
};

const deliveryOf = (notificationId: string, channel: string) =>
  getClient().deliveries.findFirst({ where: { notificationId, channel } });

beforeEach(() => asDeployed());

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saving channel settings', () => {
  it('turns email on with what was saved, under who saved it', async () => {
    const response = await put(
      '/channels/email',
      { from: 'hello@host.test', fromName: 'Host', replyTo: 'help@host.test' },
      signedIn({ email: 'ops@chaski.test', name: 'Ops' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      settings: {
        from: 'hello@host.test',
        fromName: 'Host',
        replyTo: 'help@host.test',
        updatedBy: { id: 'ops@chaski.test', name: 'Ops' },
        updatedAt: expect.any(String),
        problem: null,
      },
    });
    expect(await chaski.ready()).toMatchObject({ channels: ['email'], problems: [] });
  });

  it('keeps a field left out and clears a blank one', async () => {
    await put('/channels/email', {
      from: 'hello@host.test',
      fromName: 'Host',
      replyTo: 'h@host.test',
    });

    await put('/channels/email', { fromName: '  ', replyTo: null });

    expect(channelOf(await overview(), 'email')?.settings).toMatchObject({
      from: 'hello@host.test',
      fromName: null,
      replyTo: null,
    });
  });

  it('sends email from the saved address', async () => {
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();
    await put('/channels/email', { from: 'hello@host.test', fromName: 'Host' });

    const { notificationId } = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 5 },
    });
    await processDeliveries(notificationId);

    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ status: 'sent' });
    expect(sent).toEqual([
      expect.objectContaining({ from: { email: 'hello@host.test', name: 'Host' } }),
    ]);
  });

  it('turns in-app on with nothing to fill in', async () => {
    expect(await (await put('/channels/in_app')).json()).toEqual({
      settings: { updatedBy: expect.any(Object), updatedAt: expect.any(String), problem: null },
    });
    expect(channelOf(await overview(), 'in_app')?.enabled).toBe(true);
  });

  it('saves each push provider on its own and turns push on with any of them', async () => {
    expect(channelOf(await overview(), 'push')?.enabled).toBe(false);

    await put('/channels/push/wns', wns);
    expect(channelOf(await overview(), 'push')?.enabled).toBe(true);
    await put('/channels/push/vapid', vapid);
    await put('/channels/push/apns', apns);
    await put('/channels/push/fcm', { serviceAccount });

    expect(channelOf(await overview(), 'push')?.providers).toEqual({
      vapid: expect.objectContaining({
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKeySet: true,
        problem: null,
      }),
      apns: expect.objectContaining({
        teamId: apns.teamId,
        keyId: apns.keyId,
        privateKeySet: true,
        ios: apns.ios,
        macos: null,
        problem: null,
      }),
      fcm: expect.objectContaining({
        projectId: 'host-app',
        clientEmail: 'chaski@host-app.iam.gserviceaccount.com',
        serviceAccountSet: true,
        problem: null,
      }),
      wns: expect.objectContaining({
        tenantId: wns.tenantId,
        clientId: wns.clientId,
        clientSecretSet: true,
        problem: null,
      }),
    });
    expect(await chaski.push.vapidPublicKey()).toEqual({ publicKey: vapid.publicKey });
  });

  it('keeps the saved secret when an update leaves it out', async () => {
    await put('/channels/push/apns', apns);

    const response = await put('/channels/push/apns', {
      keyId: 'KEY7654321',
      ios: null,
      macos: { bundleId: 'com.host.desktop', environment: 'production' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      settings: expect.objectContaining({
        keyId: 'KEY7654321',
        privateKeySet: true,
        ios: null,
        macos: { bundleId: 'com.host.desktop', environment: 'production' },
        problem: null,
      }),
    });
    expect(resolveConfig().channels.push?.apns).toMatchObject({
      keyId: 'KEY7654321',
      privateKeyPem: apns.privateKey,
    });
  });

  it('saves the default muted types every contact starts from', async () => {
    const response = await put('/preferences/defaults', { mutedTypes: ['marketing.*'] });

    expect(await response.json()).toEqual({
      defaults: {
        mutedTypes: ['marketing.*'],
        updatedBy: expect.objectContaining({ id: 'admin@chaski.test' }),
        updatedAt: expect.any(String),
        problem: null,
      },
    });
    expect(await chaski.preferences.get('user_1')).toEqual({
      channels: {},
      mutedTypes: ['marketing.*'],
    });
    expect((await put('/preferences/defaults', { mutedTypes: ['x'.repeat(129)] })).status).toBe(
      400,
    );
  });
});

describe('secrets', () => {
  it('never come back from the API', async () => {
    await saveAll();

    const text = await (await api('/channels')).text();

    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it('are stored sealed, never in plain text', async () => {
    await saveAll();

    const { results } = await env.CHASKI_DB.prepare('SELECT * FROM settings').all();
    const raw = JSON.stringify(results);

    for (const secret of SECRETS) expect(raw).not.toContain(secret);
    expect((await settingsRow('wns'))?.secret).toMatch(/^v1\./);
  });

  it('need CHASKI_SECRET to be saved, and say how to set one', async () => {
    asDeployed({ secret: undefined });

    const missing = await put('/channels/push/wns', wns);

    expect(missing.status).toBe(500);
    expect(await missing.json()).toEqual({
      error: 'config',
      message:
        'Chaski config: CHASKI_SECRET is missing, and channels.push.wns.clientSecret is stored ' +
        'encrypted with it: run `wrangler secret put CHASKI_SECRET` with a value from ' +
        '`openssl rand -base64 32`',
    });
    expect((await overview()).secret).toBe('missing');

    asDeployed({ secret: 'too-short' });
    expect(await (await put('/channels/push/wns', wns)).json()).toEqual({
      error: 'config',
      message:
        'Chaski config: CHASKI_SECRET must be at least 32 characters: run `wrangler secret put ' +
        'CHASKI_SECRET` with a value from `openssl rand -base64 32`',
    });

    // Settings without a secret don't need it.
    expect((await put('/channels/email', { from: 'hello@host.test' })).status).toBe(200);
  });

  it('only open in the section they were saved in', async () => {
    await put('/channels/push/apns', apns);
    await put('/channels/push/wns', wns);
    const sealed = (await settingsRow('apns'))?.secret;
    await env.CHASKI_DB.prepare("UPDATE settings SET secret = ? WHERE section = 'wns'")
      .bind(sealed ?? null)
      .run();

    expect((await providerOf('wns'))?.problem).toBe(
      "Chaski config: channels.push.wns.clientSecret doesn't decrypt with this CHASKI_SECRET: " +
        'set the CHASKI_SECRET it was saved with, or save channels.push.wns again',
    );
    expect((await providerOf('apns'))?.problem).toBeNull();
  });
});

describe('a saved section that stops validating', () => {
  it('leaves the dashboard and the other channels working when CHASKI_SECRET changes', async () => {
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'push');
    const sent = stubEmail();
    await put('/channels/email', { from: 'hello@host.test' });
    await put('/channels/push/vapid', vapid);
    await chaski.push.register({
      recipient: recipient(),
      subscription: await browserSubscription('https://push.example/sub/1'),
    });

    asDeployed({ secret: 'another-secret-just-as-long-as-the-first-one' });
    const problem =
      "Chaski config: channels.push.vapid.privateKey doesn't decrypt with this CHASKI_SECRET: " +
      'set the CHASKI_SECRET it was saved with, or save channels.push.vapid again';

    expect((await providerOf('vapid'))?.problem).toBe(problem);
    expect(await chaski.ready()).toMatchObject({
      channels: ['email', 'push'],
      problems: [{ channel: 'push', message: problem }],
    });
    const { notificationId } = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 5 },
    });
    await processDeliveries(notificationId);

    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(await deliveryOf(notificationId, 'push')).toMatchObject({
      status: 'failed',
      errorCode: 'config',
      lastError: problem,
    });
  });

  it('fails its deliveries with the reason when its binding goes', async () => {
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'in_app');
    await put('/channels/email', { from: 'hello@host.test' });
    await put('/channels/in_app');

    asDeployed({ bindings: { ...fixtureConfig(env).bindings, email: undefined } });
    const problem =
      'Chaski config: channels.email is configured but the CHASKI_EMAIL binding is missing';

    expect(channelOf(await overview(), 'email')).toMatchObject({
      enabled: true,
      settings: expect.objectContaining({ problem }),
    });
    expect((await chaski.ready()).problems).toEqual([{ channel: 'email', message: problem }]);
    const { notificationId } = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 5 },
    });
    await processDeliveries(notificationId);

    expect(await deliveryOf(notificationId, 'email')).toMatchObject({
      status: 'failed',
      errorCode: 'config',
      lastError: problem,
    });
    expect(await deliveryOf(notificationId, 'in_app')).toMatchObject({ status: 'sent' });
  });

  it('fails only the platforms of its push provider', async () => {
    await seedTemplate('payment_received', 'push');
    await put('/channels/push/vapid', vapid);
    await put('/channels/push/apns', apns);
    // The APNs key, sealed for its own section, doesn't open in web push's.
    await env.CHASKI_DB.prepare("UPDATE settings SET secret = ? WHERE section = 'vapid'")
      .bind((await settingsRow('apns'))?.secret ?? null)
      .run();
    await chaski.push.register({
      recipient: recipient(),
      subscription: await browserSubscription('https://push.example/sub/1'),
    });
    await chaski.push.register({
      recipient: recipient(),
      platform: 'ios',
      deviceToken: 'a1b2c3d4'.repeat(8),
    });
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(String(input));
      return new Response(null, { status: 200, headers: { 'apns-id': 'apns-1' } });
    });

    const { notificationId } = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 5 },
      channels: ['push'],
    });
    await processDeliveries(notificationId);

    expect(await deliveryOf(notificationId, 'push')).toMatchObject({
      status: 'sent',
      providerMessageId: 'push:1/2',
    });
    expect(calls).toEqual([expect.stringContaining('api.sandbox.push.apple.com')]);
  });
});

describe('removing a section', () => {
  it('turns its channel off, so a schedule made before skips it', async () => {
    await seedTemplate('payment_received', 'email');
    await put('/channels/email', { from: 'hello@host.test' });
    const { scheduledId } = await ScheduleService.schedule({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 5 },
      channels: ['email'],
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(await (await remove('/channels/email')).json()).toEqual({ id: 'email', deleted: true });
    expect(channelOf(await overview(), 'email')).toMatchObject({ enabled: false, settings: null });
    await ScheduleService.fire(scheduledId);

    const notification = await getClient().notifications.findFirst({
      where: { recipientId: 'user_1' },
    });
    expect(await deliveryOf(notification?.id ?? '', 'email')).toMatchObject({
      status: 'skipped',
      skipReason: 'channel_not_configured',
    });
    expect((await remove('/channels/email')).status).toBe(404);
  });
});

describe('VAPID keys', () => {
  it('generates a pair whose public key the app hands to browsers', async () => {
    const response = await post('/channels/push/vapid/generate', { subject: vapid.subject });

    expect(response.status).toBe(200);
    const { settings } = (await response.json()) as { settings: { publicKey: string } };
    expect(settings).toMatchObject({ subject: vapid.subject, privateKeySet: true, problem: null });
    expect(await exports.ChaskiEntrypoint.push().vapidPublicKey()).toEqual({
      publicKey: settings.publicKey,
    });
  });

  it('replaces a saved pair only when asked to', async () => {
    await put('/channels/push/vapid', vapid);

    const refused = await post('/channels/push/vapid/generate', { subject: vapid.subject });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'conflict' });
    expect(await chaski.push.vapidPublicKey()).toEqual({ publicKey: vapid.publicKey });

    const replaced = await post('/channels/push/vapid/generate', {
      subject: vapid.subject,
      replace: true,
    });
    expect(replaced.status).toBe(200);
    expect(await chaski.push.vapidPublicKey()).not.toEqual({ publicKey: vapid.publicKey });
    // The subject alone changes without touching the pair.
    expect((await put('/channels/push/vapid', { subject: 'https://host.test' })).status).toBe(200);
  });

  it('refuses a private key that is not the public key’s', async () => {
    const other = await vapidKeys();

    const response = await put('/channels/push/vapid', { ...vapid, privateKey: other.privateKey });

    expect(await response.json()).toEqual({
      error: 'validation',
      message:
        'Chaski config: channels.push.vapid.privateKey is not the private key of ' +
        'channels.push.vapid.publicKey',
    });
    expect(
      (await put('/channels/push/vapid', { subject: vapid.subject, publicKey: vapid.publicKey }))
        .status,
    ).toBe(400);
  });
});

describe('validating a save', () => {
  const thrownBy = (channels: ChaskiConfig['channels']) => {
    try {
      validateConfig({ ...fixtureConfig(env), channels });
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('validateConfig accepted it');
  };

  it.each([
    ['email', '/channels/email', { from: 'nobody' }, { email: { from: 'nobody' } }],
    [
      'web push',
      '/channels/push/vapid',
      { ...vapid, subject: 'http://host.test' },
      { push: { vapid: { ...vapid, subject: 'http://host.test' } } },
    ],
    [
      'APNs',
      '/channels/push/apns',
      { ...apns, ios: null },
      { push: { apns: { ...apns, ios: undefined } } },
    ],
    [
      'APNs',
      '/channels/push/apns',
      { ...apns, ios: { bundleId: 'com.host.app', environment: 'staging' } },
      { push: { apns: { ...apns, ios: { bundleId: 'com.host.app', environment: 'staging' } } } },
    ],
    [
      'FCM',
      '/channels/push/fcm',
      { serviceAccount: '{"project_id":"host-app"}' },
      { push: { fcm: { serviceAccount: '{"project_id":"host-app"}' } } },
    ],
    [
      'WNS',
      '/channels/push/wns',
      { tenantId: 'tenant-1', clientSecret: 'secret' },
      { push: { wns: { tenantId: 'tenant-1', clientSecret: 'secret' } } },
    ],
  ])('refuses %s with the message validateConfig gives', async (_, path, body, channels) => {
    const response = await put(path, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation',
      message: thrownBy(channels as ChaskiConfig['channels']),
    });
  });

  it.each([
    ['email', '/channels/email', 'email', 'CHASKI_EMAIL'],
    ['in_app', '/channels/in_app', 'feed', 'CHASKI_FEED'],
  ] as const)('refuses %s without its binding', async (channel, path, binding, name) => {
    asDeployed({ bindings: { ...fixtureConfig(env).bindings, [binding]: undefined } });

    const response = await put(path, { from: 'hello@host.test' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'config',
      message: `Chaski config: channels.${channel} is configured but the ${name} binding is missing`,
    });
    expect((await overview()).bindings).toMatchObject({ [binding]: false });
  });
});

describe('a change on the Channels page', () => {
  beforeEach(async () => {
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'in_app');
    await put('/channels/email', { from: 'hello@host.test' });
    await put('/channels/in_app');
    await put('/channels/push/vapid', vapid);
  });

  it('reaches the RPC methods on their next call', async () => {
    await deleteElsewhere('vapid');
    expect(await exports.ChaskiEntrypoint.push().vapidPublicKey()).toEqual({ publicKey: null });

    await deleteElsewhere('in_app');
    expect(await exports.ChaskiEntrypoint.ready()).toMatchObject({ channels: ['email'] });
  });

  it('reaches the routes the app forwards and the admin API', async () => {
    await deleteElsewhere('vapid');
    const response = await exports.ChaskiEntrypoint.fetch(
      new Request('https://chaski.test/push/vapid-public-key', {
        headers: { [RECIPIENT_HEADER]: 'user_1' },
      }),
    );
    expect(await response.json()).toEqual({ publicKey: null });

    await deleteElsewhere('in_app');
    expect(channelOf(await overview(), 'in_app')?.enabled).toBe(false);
  });

  it('reaches the queue on its next batch', async () => {
    stubEmail();
    const { notificationId } = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 5 },
    });
    await deleteElsewhere('email');

    const batch = createMessageBatch(
      'chaski-deliveries',
      queuedMessages().map((body, index) => ({
        id: String(index),
        timestamp: new Date(),
        attempts: 1,
        body,
      })),
    );
    const ctx = createExecutionContext();
    await worker.queue(batch);
    await getQueueResult(batch, ctx);

    expect(await deliveryOf(notificationId, 'email')).toMatchObject({
      status: 'failed',
      errorCode: 'channel_not_configured',
    });
    expect(await deliveryOf(notificationId, 'in_app')).toMatchObject({ status: 'sent' });
  });

  it('reaches the scheduler when it fires', async () => {
    // The instance starts only once in-app is off elsewhere, so it can't fire before the change.
    const created: WorkflowInstanceCreateOptions<{ scheduledId: string }>[] = [];
    const held = { create: async (options: (typeof created)[number]) => created.push(options) };
    asDeployed({ bindings: { ...fixtureConfig(env).bindings, scheduler: held as never } });
    await chaski.schedule({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 5 },
      channels: ['in_app'],
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    });
    asDeployed();
    await deleteElsewhere('in_app');
    await using scheduler = await introspectWorkflow(env.CHASKI_SCHEDULER);
    await scheduler.modifyAll(async (m) => {
      await m.disableSleeps();
      await m.mockStepResult({ name: 'resolve 0' }, { scheduledAtMs: Date.now(), due: true });
    });

    await env.CHASKI_SCHEDULER.create(created[0]);
    const [instance] = await scheduler.get();
    await instance?.waitForStatus('complete');

    const notification = await getClient().notifications.findFirst({
      where: { recipientId: 'user_1' },
    });
    expect(await deliveryOf(notification?.id ?? '', 'in_app')).toMatchObject({
      status: 'skipped',
      skipReason: 'channel_not_configured',
    });
  });

  it('is never read before the settings load', async () => {
    setStoredSettings(undefined);
    expect(() => resolveConfig()).toThrowError(
      'Chaski read its config before loading the channel settings: await ready() first',
    );

    // The open pixel needs only the bindings, so it answers before anything loads them.
    const pixel = await exports.ChaskiEntrypoint.fetch('https://chaski.test/t/o/d_unknown');
    expect(pixel.status).toBe(200);
    expect(await exports.ChaskiEntrypoint.feed().unreadCount('user_1')).toEqual({ unread: 0 });
    expect(resolveConfig().enabledChannels).toEqual(['email', 'in_app', 'push']);
  });
});
