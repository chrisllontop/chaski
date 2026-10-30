import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api as chaski } from '../src/server/api';
import { getClient } from '../src/server/db';
import { healthOf } from '../src/server/services/metrics.service';
import { api, processDeliveries, recipient, seedTemplate, stubEmail } from './helpers';

describe('healthOf', () => {
  const stats = { volume: 100, sent: 100, failed: 0, pending: 0, skipped: 0 };

  it('blocks a type once failures reach a quarter of its volume', () => {
    expect(healthOf({ ...stats, sent: 75, failed: 25 })).toBe('blocked');
    expect(healthOf({ ...stats, sent: 76, failed: 24 })).toBe('at_risk');
  });

  it('puts a type at risk on any failure, or when pending outnumbers sent', () => {
    expect(healthOf({ ...stats, sent: 99, failed: 1 })).toBe('at_risk');
    expect(healthOf({ ...stats, sent: 40, pending: 60 })).toBe('at_risk');
    expect(healthOf({ ...stats, sent: 60, pending: 40 })).toBe('healthy');
  });

  it('pauses a type whose deliveries were all skipped', () => {
    expect(healthOf({ ...stats, sent: 0, skipped: 100 })).toBe('paused');
    expect(healthOf({ ...stats, sent: 1, skipped: 99 })).toBe('healthy');
  });
});

describe('GET /api/metrics/types', () => {
  beforeEach(async () => {
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'in_app');
    stubEmail();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('labels each type and channel with its health', async () => {
    for (const id of ['user_1', 'user_2']) {
      const { notificationId } = await chaski.send({
        type: 'payment_received',
        recipient: recipient(id),
        payload: { amount: 10 },
      });
      await processDeliveries(notificationId);
    }
    const [email] = await getClient().deliveries.findMany({ where: { channel: 'email' } });
    await getClient().deliveries.update({
      where: { id: email?.id ?? '' },
      data: { status: 'dead' },
    });

    const body = (await (await api('/metrics/types?period=7d')).json()) as {
      types: Array<{ channel: string; health: string }>;
    };

    expect(body.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'email', health: 'blocked' }),
        expect.objectContaining({ channel: 'in_app', health: 'healthy' }),
      ]),
    );
  });
});
