import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { chaski, fixtureConfig } from './fixture/worker';
import {
  api,
  processDeliveries,
  queuedMessages,
  recipient,
  seedTemplate,
  stubEmail,
  useConfig,
} from './helpers';

const send = async (recipientId = 'user_1') => {
  const result = await chaski.send({
    type: 'payment_received',
    recipient: recipient(recipientId),
    payload: { amount: 10 },
  });
  await processDeliveries(result.notificationId);
  return result;
};

const setStatus = (id: string, status: string) =>
  getClient().deliveries.update({ where: { id }, data: { status } });

// The fields these tests read from the admin API's answers.
type Body = {
  total: number;
  message: string;
  delivery: unknown;
  deliveries: Array<{ recipientId: string }>;
  series: unknown[];
  types: unknown[];
};

const json = async (path: string, init?: RequestInit) => {
  const response = await api(path, init);
  return { status: response.status, body: (await response.json()) as Body };
};

beforeEach(async () => {
  await seedTemplate('payment_received', 'email');
  await seedTemplate('payment_received', 'in_app');
  stubEmail();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/deliveries', () => {
  it('lists deliveries newest first with their notification and address', async () => {
    await send('user_1');
    await send('user_2');

    const { body } = await json('/deliveries?channel=email');

    expect(body.total).toBe(2);
    expect(body.deliveries.map((d) => d.recipientId)).toEqual(['user_2', 'user_1']);
    expect(body.deliveries[0]).toMatchObject({
      channel: 'email',
      status: 'sent',
      type: 'payment_received',
      address: 'ana@example.com',
      payload: { amount: 10 },
    });
  });

  it('filters by status, recipient and opens, and pages', async () => {
    await send('user_1');
    await send('user_2');
    await send('user_3');

    const page = await json('/deliveries?status=sent&limit=2&page=1');
    expect(page.body).toMatchObject({ total: 6, page: 1, limit: 2 });
    expect(page.body.deliveries).toHaveLength(2);

    const byRecipient = await json('/deliveries?recipientId=user_3');
    expect(byRecipient.body.total).toBe(2);

    const opened = await json('/deliveries?opened=true');
    expect(opened.body.total).toBe(0);
  });

  it('rejects an unknown status', async () => {
    expect((await json('/deliveries?status=lost')).status).toBe(400);
  });

  it('counts deliveries per status under the other filters', async () => {
    const { notificationId } = await send();
    const email = await getClient().deliveries.findFirst({
      where: { notificationId, channel: 'email' },
    });
    await setStatus(email?.id ?? '', 'dead');

    expect((await json('/deliveries/counts')).body).toEqual({ counts: { dead: 1, sent: 1 } });
    expect((await json('/deliveries/counts?channel=in_app')).body).toEqual({
      counts: { sent: 1 },
    });
  });

  it('shows one delivery, or 404', async () => {
    const { deliveries } = await send();

    expect((await json(`/deliveries/${deliveries[0]?.id}`)).body.delivery).toMatchObject({
      id: deliveries[0]?.id,
    });
    expect((await json('/deliveries/d_missing')).status).toBe(404);
  });
});

describe('replay', () => {
  it('requeues a failed delivery from scratch', async () => {
    const { deliveries } = await send();
    const id = deliveries[0]?.id ?? '';
    await getClient().deliveries.update({
      where: { id },
      data: { status: 'failed', attempts: 3, errorCode: 'validation_error' },
    });

    const { status, body } = await json(`/deliveries/${id}/replay`, { method: 'POST' });

    expect(status).toBe(200);
    expect(body).toEqual({ requeued: 1 });
    expect(await getClient().deliveries.findFirst({ where: { id } })).toMatchObject({
      status: 'pending',
      attempts: 0,
      errorCode: null,
    });
    expect(queuedMessages()).toContainEqual(expect.objectContaining({ deliveryId: id }));
  });

  it('refuses a delivery that is not failed or dead', async () => {
    const { deliveries } = await send();

    const { status, body } = await json(`/deliveries/${deliveries[0]?.id}/replay`, {
      method: 'POST',
    });

    expect(status).toBe(409);
    expect(body.message).toContain('only failed and dead deliveries replay');
  });

  it('requeues every dead delivery', async () => {
    const first = await send('user_1');
    const second = await send('user_2');
    for (const d of [...first.deliveries, ...second.deliveries])
      await setStatus(d.id ?? '', 'dead');

    expect((await json('/deliveries/replay-dead', { method: 'POST' })).body).toEqual({
      requeued: 4,
    });
    expect((await json('/deliveries/counts')).body).toEqual({ counts: { pending: 4 } });
  });
});

describe('metrics', () => {
  it('lists only the error codes of deliveries that ended', async () => {
    const { deliveries } = await send('user_1');
    const [email, inApp] = deliveries;
    await getClient().deliveries.update({
      where: { id: email?.id ?? '' },
      data: { status: 'dead', errorCode: 'internal_server_error' },
    });
    // Still retrying: it has an error code but has not failed yet.
    await getClient().deliveries.update({
      where: { id: inApp?.id ?? '' },
      data: { status: 'pending', errorCode: 'provider_error' },
    });

    const { body } = await json('/metrics/overview?period=7d');

    expect(body).toMatchObject({
      topErrorCodes: [{ errorCode: 'internal_server_error', count: 1 }],
    });
  });

  it('counts opens by when they happened, in the totals and by type', async () => {
    const { deliveries } = await send('user_1');
    const email = deliveries.find((d) => d.channel === 'email');
    // Opened long before this period, though the delivery changed inside it.
    await getClient().deliveries.update({
      where: { id: email?.id ?? '' },
      data: { openedAt: new Date('2025-01-01T00:00:00Z') },
    });

    const overview = await json('/metrics/overview?period=7d');
    const byType = await json('/metrics/types?period=7d');

    expect(overview.body).toMatchObject({ opened: 0 });
    expect(byType.body.types).toContainEqual(
      expect.objectContaining({ channel: 'email', sent: 1, opened: 0 }),
    );
  });

  it('summarizes the period', async () => {
    const { deliveries } = await send('user_1');
    await send('user_2');
    await setStatus(deliveries[0]?.id ?? '', 'failed');
    await getClient().deliveries.update({
      where: { id: deliveries[0]?.id ?? '' },
      data: { errorCode: 'validation_error' },
    });

    const { body } = await json('/metrics/overview?period=7d');

    expect(body).toMatchObject({
      period: '7d',
      notifications: 2,
      deliveries: 4,
      sent: 3,
      failed: 1,
      successRate: 75,
      byChannel: { email: 2, in_app: 2 },
      topErrorCodes: [{ errorCode: 'validation_error', count: 1 }],
      scheduledPending: 0,
    });
  });

  it('fills every day of the period in the time series', async () => {
    await send();

    const { body } = await json('/metrics/timeseries?period=7d');

    expect(body.series.length).toBeGreaterThanOrEqual(7);
    expect(body.series.at(-1)).toMatchObject({ notifications: 1, sent: 2 });
  });

  it('breaks outcomes down by type and channel', async () => {
    await send();

    const { body } = await json('/metrics/types');

    expect(body.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'payment_received', channel: 'email', sent: 1 }),
        expect.objectContaining({ type: 'payment_received', channel: 'in_app', sent: 1 }),
      ]),
    );
  });

  it('rejects an unknown period', async () => {
    expect((await json('/metrics/overview?period=1y')).status).toBe(400);
  });
});

describe('GET /api/channels', () => {
  it('shows what the host configured and none of its secrets', async () => {
    const config = fixtureConfig(env);
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    const raw = new Uint8Array(
      (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
    );
    const publicKey = btoa(String.fromCharCode(...raw))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    useConfig({
      channels: {
        ...config.channels,
        push: { vapid: { subject: 'mailto:ops@host.test', publicKey, privateKey: jwk.d ?? '' } },
      },
    });

    const response = await api('/channels');
    const text = await response.text();

    expect(JSON.parse(text)).toEqual({
      environment: null,
      realtime: true,
      canPause: true,
      channels: [
        expect.objectContaining({
          channel: 'email',
          enabled: true,
          paused: null,
          from: 'notifications@host.test',
        }),
        { channel: 'in_app', enabled: true, paused: null },
        {
          channel: 'push',
          enabled: true,
          paused: null,
          web: { vapidPublicKey: publicKey },
          ios: null,
          macos: null,
          android: null,
          windows: null,
        },
      ],
    });
    expect(text).not.toContain(jwk.d);
  });

  it('says when realtime events are off', async () => {
    useConfig({ bindings: { ...fixtureConfig(env).bindings, events: undefined } });

    const response = await api('/channels');

    expect(await response.json()).toMatchObject({ realtime: false });
  });
});
