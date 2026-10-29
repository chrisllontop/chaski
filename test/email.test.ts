import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { NotificationService } from '../src/server/services/notification.service';
import { api, processDeliveries, recipient, seedTemplate, stubEmail, useConfig } from './helpers';

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
        from: { email: 'notifications@host.test', name: 'Fixture host' },
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

  describe('HTML body', () => {
    const NAME = 'Ana <a href="https://evil.test">Reset your password</a> & co';
    const ESCAPED =
      'Ana &lt;a href=&#34;https://evil.test&#34;&gt;Reset your password&lt;/a&gt; &amp; co';
    const BODY = '<p>{{ recipient.name }}|{{ recipient.name | escape }}</p>{{ summary | raw }}';

    const seedHtmlTemplate = async () => {
      await seedTemplate('payment_received', 'email');
      await getClient().templateChannels.updateMany({
        where: { channel: 'email' },
        data: { subject: 'Hi {{ recipient.name }}', body: BODY, textBody: '{{ recipient.name }}' },
      });
    };

    it('escapes every value unless the template marks it raw', async () => {
      await seedHtmlTemplate();
      const sent = stubEmail();

      await sendPayment({
        recipient: { ...recipient(), name: NAME },
        payload: { summary: '<ul><li>1500</li></ul>' },
      });

      // `| escape` isn't escaped twice, and only the HTML body is escaped.
      expect(sent[0]?.html).toContain(`<p>${ESCAPED}|${ESCAPED}</p><ul><li>1500</li></ul>`);
      expect(sent[0]).toMatchObject({ subject: `Hi ${NAME}`, text: NAME });
    });

    it('previews the body as it goes out', async () => {
      await seedHtmlTemplate();

      const response = await api('/templates/tpl_payment_received/preview', {
        method: 'POST',
        body: JSON.stringify({ channel: 'email', data: { recipient: { name: NAME } } }),
      });

      expect(await response.json()).toMatchObject({
        subject: `Hi ${NAME}`,
        html: `<p>${ESCAPED}|${ESCAPED}</p>`,
      });
    });
  });

  it('applies per-send sender overrides', async () => {
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();

    await sendPayment({ email: { fromName: 'Billing, Acme', replyTo: 'billing@host.test' } });

    // The name stays out of the address, so its comma can't split the sender in two.
    expect(sent[0]).toMatchObject({
      from: { email: 'notifications@host.test', name: 'Billing, Acme' },
      replyTo: 'billing@host.test',
    });
  });

  it('sends a bare address when no sender name is configured', async () => {
    useConfig({ channels: { email: { from: 'notifications@host.test' }, in_app: {} } });
    await seedTemplate('payment_received', 'email');
    const sent = stubEmail();

    await sendPayment();

    expect(sent[0]?.from).toBe('notifications@host.test');
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
});
