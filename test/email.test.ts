import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { NotificationService } from '../src/server/services/notification.service';
import { processDeliveries, recipient, seedTemplate, stubEmail, useConfig } from './helpers';

const findEmailDelivery = (notificationId: string) =>
  getClient().deliveries.findFirst({ where: { notificationId, channel: 'email' } });

const sendPayment = async (extra: Record<string, unknown> = {}) => {
  const result = await NotificationService.send({
    type: 'payment_received',
    recipient: recipient(),
    payload: { amount: 1500 },
    ...extra,
  });
  await processDeliveries(result.notificationId);
  return result;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('email channel', () => {
  it('renders the template and sends it from the configured sender', async () => {
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();

    const result = await sendPayment();

    expect(result.deliveries).toContainEqual(
      expect.objectContaining({ channel: 'email', status: 'pending' }),
    );
    expect(sent).toEqual([
      expect.objectContaining({
        to: 'ana@example.com',
        from: 'Fixture host <notifications@host.test>',
        subject: 'Hello Ana',
        text: 'Amount: 1500',
      }),
    ]);
    expect(await findEmailDelivery(result.notificationId)).toMatchObject({
      status: 'sent',
      providerMessageId: 'msg_1',
      attempts: 1,
    });
  });

  it('builds the open pixel from publicUrl, with no request to derive it from', async () => {
    useConfig({ publicUrl: 'https://app.example.com/notifications/' });
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();

    const result = await sendPayment();

    const delivery = await findEmailDelivery(result.notificationId);
    expect(sent[0]?.html).toContain(
      `<img src="https://app.example.com/notifications/t/o/${delivery?.id}"`,
    );
  });

  it('applies per-send sender overrides', async () => {
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();

    await sendPayment({ email: { fromName: 'Billing', replyTo: 'billing@host.test' } });

    expect(sent[0]).toMatchObject({
      from: 'Billing <notifications@host.test>',
      replyTo: 'billing@host.test',
    });
  });

  it('skips a contact without an email address', async () => {
    await seedTemplate('payment_received', 'email');

    const result = await NotificationService.send({
      type: 'payment_received',
      recipient: { id: 'user_2' },
    });

    expect(result.outcome).toBe('undeliverable');
    expect(result.deliveries).toEqual([
      expect.objectContaining({ channel: 'email', status: 'skipped', reason: 'missing_email' }),
      expect.objectContaining({ channel: 'in_app', status: 'skipped', reason: 'no_template' }),
    ]);
  });

  it('sends attachments in the Email Service wire shape', async () => {
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();

    await sendPayment({
      email: {
        attachments: [
          { filename: 'invoice.pdf', contentType: 'application/pdf', content: btoa('pdf-bytes') },
        ],
      },
    });

    const attachment = sent[0]?.attachments?.[0];
    expect(attachment).toMatchObject({
      filename: 'invoice.pdf',
      type: 'application/pdf',
      disposition: 'attachment',
    });
    expect(attachment).not.toHaveProperty('contentType');
  });

  it('marks payload rejections failed without retrying', async () => {
    await seedTemplate('payment_received', 'email');
    stubEmail(async () => {
      throw Object.assign(new Error('Invalid `mimeType` given: mime parse error'), {
        code: 'E_VALIDATION_ERROR',
      });
    });

    const result = await sendPayment();

    expect(await findEmailDelivery(result.notificationId)).toMatchObject({
      status: 'failed',
      errorCode: 'validation_error',
      attempts: 1,
    });
  });

  it('keeps unrecognized send errors retryable', async () => {
    await seedTemplate('payment_received', 'email');
    stubEmail(async () => {
      throw Object.assign(new Error('service hiccup'), { code: 'E_INTERNAL_SERVER_ERROR' });
    });

    const result = await sendPayment();

    expect(await findEmailDelivery(result.notificationId)).toMatchObject({
      status: 'pending',
      errorCode: 'internal_server_error',
      attempts: 1,
    });
  });

  it('renders and records a dry run without calling the binding', async () => {
    useConfig({ dryRun: true });
    await seedTemplate('payment_received', 'email');
    const send = vi.spyOn(env.CHASKI_EMAIL, 'send');

    const result = await sendPayment();

    expect(send).not.toHaveBeenCalled();
    expect(await findEmailDelivery(result.notificationId)).toMatchObject({
      status: 'sent',
      providerMessageId: 'dry-run',
    });
  });
});
