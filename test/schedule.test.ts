import { introspectWorkflow } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getClient } from '../src/server/db';
import { ScheduleService } from '../src/server/services/schedule.service';
import { chaski, fixtureConfig } from './fixture/worker';
import { recipient, seedTemplate, useConfig } from './helpers';

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const schedule = (extra: Record<string, unknown> = {}) =>
  chaski.schedule({
    type: 'payment_received',
    recipient: recipient(),
    payload: { amount: 1500 },
    channels: ['in_app'],
    scheduledAt: inMinutes(60),
    ...extra,
  });

const scheduledRow = (id: string) =>
  getClient().scheduledNotifications.findFirst({ where: { id } });

describe('chaski.schedule', () => {
  it('sends through the scheduler once the time comes', async () => {
    await seedTemplate('payment_received', 'in_app');
    await using scheduler = await introspectWorkflow(env.CHASKI_SCHEDULER);
    // Disabled sleeps don't move the clock, so the first check reports the
    // schedule due the way it would be after sleeping until scheduledAt.
    await scheduler.modifyAll(async (m) => {
      await m.disableSleeps();
      await m.mockStepResult({ name: 'resolve 0' }, { scheduledAtMs: Date.now(), due: true });
    });

    const { scheduledId } = await schedule({ idempotencyKey: 'reminder-1' });

    const [instance] = await scheduler.get();
    await instance?.waitForStatus('complete');
    expect(await scheduledRow(scheduledId)).toMatchObject({ status: 'promoted' });
    const notification = await getClient().notifications.findFirst({
      where: { idempotencyKey: 'reminder-1' },
    });
    expect(notification).toMatchObject({ type: 'payment_received', recipientId: 'user_1' });
  });

  it('moves a pending schedule declared again with the same key', async () => {
    await seedTemplate('payment_received', 'in_app');
    const first = await schedule({ idempotencyKey: 'digest' });

    const later = inMinutes(120);
    const moved = await schedule({ idempotencyKey: 'digest', scheduledAt: later });

    expect(moved).toEqual({ scheduledId: first.scheduledId, scheduledAt: later, op: 'updated' });
    expect(await chaski.schedules.list()).toEqual([
      expect.objectContaining({ id: first.scheduledId, scheduledAt: later }),
    ]);
  });

  it('reports a key that already fired as completed', async () => {
    await seedTemplate('payment_received', 'in_app');
    const first = await schedule({ idempotencyKey: 'once' });
    await getClient().scheduledNotifications.update({
      where: { id: first.scheduledId },
      data: { status: 'promoted' },
    });

    expect(await schedule({ idempotencyKey: 'once' })).toMatchObject({
      scheduledId: first.scheduledId,
      op: 'completed',
    });
  });

  it('retires a pending schedule moved into the past instead of firing it late', async () => {
    await seedTemplate('payment_received', 'in_app');
    const first = await schedule({ idempotencyKey: 'late' });

    const result = await schedule({ idempotencyKey: 'late', scheduledAt: inMinutes(-60) });

    expect(result).toMatchObject({ scheduledId: first.scheduledId, op: 'cancelled' });
    expect(await scheduledRow(first.scheduledId)).toMatchObject({ status: 'cancelled' });
  });

  it('rejects a new schedule in the past or without an offset', async () => {
    await seedTemplate('payment_received', 'in_app');

    await expect(schedule({ scheduledAt: inMinutes(-60) })).rejects.toMatchObject({
      code: 'validation',
      message: 'scheduledAt is in the past',
    });
    await expect(schedule({ scheduledAt: '2030-01-01T09:00:00' })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('needs the scheduler binding', async () => {
    await seedTemplate('payment_received', 'in_app');
    const config = fixtureConfig(env);
    useConfig({ bindings: { ...config.bindings, scheduler: undefined } });

    await expect(schedule()).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining('bindings.scheduler is missing'),
    });
  });
});

describe('chaski.schedules', () => {
  it('lists pending schedules soonest first, by recipient', async () => {
    await seedTemplate('payment_received', 'in_app');
    const later = await schedule({ scheduledAt: inMinutes(90) });
    const sooner = await schedule({ scheduledAt: inMinutes(30) });
    await schedule({ recipient: recipient('user_2') });

    const pending = await chaski.schedules.list({ recipientId: 'user_1' });

    expect(pending.map((item) => item.id)).toEqual([sooner.scheduledId, later.scheduledId]);
  });

  it('cancels by group, and the scheduler then has nothing to send', async () => {
    await seedTemplate('payment_received', 'in_app');
    const a = await schedule({ groupKey: 'trial-ending' });
    await schedule({ groupKey: 'trial-ending' });
    await schedule({ groupKey: 'other' });

    expect(await chaski.schedules.cancel({ groupKey: 'trial-ending' })).toEqual({ cancelled: 2 });
    expect(await ScheduleService.workflowTarget(a.scheduledId)).toBeNull();
    await ScheduleService.fire(a.scheduledId);
    expect(await getClient().notifications.findMany({ where: {} })).toEqual([]);
  });

  it('needs something to cancel by', async () => {
    await expect(chaski.schedules.cancel({})).rejects.toMatchObject({ code: 'validation' });
  });
});
