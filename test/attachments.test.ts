import { introspectWorkflow } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api as chaski } from '../src/server/api';
import { getClient } from '../src/server/db';
import { NotificationService } from '../src/server/services/notification.service';
import { processDeliveries, recipient, seedTemplate, stubEmail } from './helpers';

const attachment = (filename: string) => ({
  filename,
  contentType: 'text/calendar',
  content: btoa('BEGIN:VCALENDAR'),
});

const storedKeys = async () =>
  (await env.CHASKI_ATTACHMENTS.list({ prefix: 'att/' })).objects.map((object) => object.key);

const sendWithInvite = async () => {
  const result = await NotificationService.send({
    type: 'payment_received',
    recipient: recipient(),
    channels: ['email'],
    email: { attachments: [attachment('invite.ics')] },
  });
  await processDeliveries(result.notificationId);
  return getClient().deliveries.findFirst({ where: { notificationId: result.notificationId } });
};

const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of await storedKeys()) await env.CHASKI_ATTACHMENTS.delete(key);
});

describe('attachments in storage', () => {
  it('go once their email goes out', async () => {
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();

    expect(await sendWithInvite()).toMatchObject({ status: 'sent' });

    expect(sent[0]?.attachments).toHaveLength(1);
    expect(await storedKeys()).toEqual([]);
  });

  // A replay sends them, so they stay until the delivery goes out or a lifecycle rule takes them.
  it('stay with a delivery that failed', async () => {
    await seedTemplate('payment_received', 'email');
    stubEmail(async () => {
      throw Object.assign(new Error('the sender is not verified'), {
        code: 'E_SENDER_NOT_VERIFIED',
      });
    });

    expect(await sendWithInvite()).toMatchObject({ status: 'failed' });

    expect(await storedKeys()).toHaveLength(1);
  });

  it('go with a schedule that is cancelled or replaced', async () => {
    await seedTemplate('payment_received', 'email');
    await using _scheduler = await introspectWorkflow(env.CHASKI_SCHEDULER);
    const schedule = (filename: string, idempotencyKey: string) =>
      chaski.schedule({
        type: 'payment_received',
        recipient: recipient(),
        scheduledAt: soon(60),
        idempotencyKey,
        groupKey: 'invites',
        email: { attachments: [attachment(filename)] },
      });

    const { scheduledId } = await schedule('first.ics', 'invite:1');
    await schedule('second.ics', 'invite:1');
    expect(await storedKeys()).toEqual([`att/${scheduledId}/0-second.ics`]);

    await chaski.schedules.cancel({ groupKey: 'invites' });
    expect(await storedKeys()).toEqual([]);
  });
});
