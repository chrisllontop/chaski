import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { chaski } from './fixture/worker';
import { api, processDeliveries, recipient, seedTemplate, stubEmail } from './helpers';

const send = async (recipientId = 'user_1') => {
  const result = await chaski.send({
    type: 'payment_received',
    recipient: recipient(recipientId),
    payload: { amount: 10 },
  });
  await processDeliveries(result.notificationId);
  return result;
};

// Pins a sent delivery's timings, so the percentiles below are known exactly.
const pin = (notificationId: string, channel: string, createdAt: number, deliverMs: number) =>
  env.CHASKI_DB.batch([
    env.CHASKI_DB.prepare('UPDATE notifications SET created_at = ? WHERE id = ?').bind(
      createdAt,
      notificationId,
    ),
    env.CHASKI_DB.prepare(
      "UPDATE deliveries SET status = 'sent', sent_at = ?, provider_ms = ? WHERE notification_id = ? AND channel = ?",
    ).bind(createdAt + deliverMs, deliverMs / 10, notificationId, channel),
  ]);

type Stats = { count: number; toDeliver: Percentiles; provider: Percentiles };
type Percentiles = { p50: number | null; p95: number | null };
type Latency = {
  overall: Stats;
  channels: Array<Stats & { channel: string }>;
  series: Array<{ date: string; count: number; p50: number | null; p95: number | null }>;
};

const latency = async (period = '7d') =>
  (await (await api(`/metrics/latency?period=${period}`)).json()) as Latency;

beforeEach(async () => {
  await seedTemplate('payment_received', 'email');
  await seedTemplate('payment_received', 'in_app');
  stubEmail();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provider time', () => {
  it('is recorded on the sending attempt of every channel', async () => {
    const { notificationId } = await send();

    const rows = await getClient().deliveries.findMany({ where: { notificationId } });

    expect(rows.map((row) => [row.channel, row.status])).toEqual(
      expect.arrayContaining([
        ['email', 'sent'],
        ['in_app', 'sent'],
      ]),
    );
    for (const row of rows) expect(row.providerMs).toBeGreaterThanOrEqual(0);
  });

  it('is recorded on an attempt that fails too', async () => {
    stubEmail(async () => {
      throw new Error('provider unavailable');
    });
    const { notificationId } = await send();

    const email = await getClient().deliveries.findFirst({
      where: { notificationId, channel: 'email' },
    });

    expect(email).toMatchObject({ status: 'pending', attempts: 1 });
    expect(email?.providerMs).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/metrics/latency', () => {
  it('reports nearest-rank percentiles per channel, overall and per day', async () => {
    const createdAt = Date.now() - 60 * 60_000;
    for (let i = 1; i <= 20; i++) {
      const { notificationId } = await send();
      await pin(notificationId, 'email', createdAt, i * 1000);
      await pin(notificationId, 'in_app', createdAt, i * 100);
    }

    const body = await latency();

    expect(body.channels).toEqual(
      expect.arrayContaining([
        {
          channel: 'email',
          count: 20,
          toDeliver: { p50: 10_000, p95: 19_000 },
          provider: { p50: 1000, p95: 1900 },
        },
        {
          channel: 'in_app',
          count: 20,
          toDeliver: { p50: 1000, p95: 1900 },
          provider: { p50: 100, p95: 190 },
        },
      ]),
    );
    // 40 samples, both channels at 1000 and 2000: rank 20 falls on 1900, rank 38 on 18000.
    expect(body.overall).toEqual({
      count: 40,
      toDeliver: { p50: 1900, p95: 18_000 },
      provider: { p50: 190, p95: 1800 },
    });
    const today = new Date(createdAt + 20_000).toISOString().slice(0, 10);
    expect(body.series).toContainEqual({ date: today, count: 40, p50: 1900, p95: 18_000 });
    expect(body.series).toHaveLength(8);
  });

  it('leaves out deliveries that were not sent, or were sent before the period', async () => {
    const { notificationId: failed } = await send('user_1');
    await getClient().deliveries.updateMany({
      where: { notificationId: failed },
      data: { status: 'failed' },
    });
    const { notificationId: old } = await send('user_2');
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60_000;
    await pin(old, 'email', tenDaysAgo, 500);
    await pin(old, 'in_app', tenDaysAgo, 500);

    const body = await latency();

    expect(body.channels).toEqual([]);
    expect(body.overall).toEqual({
      count: 0,
      toDeliver: { p50: null, p95: null },
      provider: { p50: null, p95: null },
    });
  });
});
