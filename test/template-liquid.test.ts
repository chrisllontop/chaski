import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { chaski } from './fixture/worker';
import { api, processDeliveries, recipient, seedTemplate, stubEmail } from './helpers';

const UNCLOSED = '<p>Hi {{ recipient.</p>';

const templateId = async () =>
  (await getClient().templates.findFirst({ where: { type: 'payment_received' } }))?.id ?? '';

beforeEach(async () => {
  await seedTemplate('payment_received', 'email');
  stubEmail();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Liquid the parser rejects', () => {
  it('is refused on save, naming the field, and leaves the stored content alone', async () => {
    const id = await templateId();

    const response = await api(`/templates/${id}/channels/email`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, subject: 'Paid', body: UNCLOSED }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'validation',
      message: expect.stringMatching(/^body: .*not closed/),
    });
    const stored = await getClient().templateChannels.findFirst({
      where: { templateId: id, channel: 'email' },
    });
    expect(stored?.body).toBe('<p>Amount: {{amount}}</p>');
  });

  it('is refused on import, preview included, naming the type and channel', async () => {
    const file = {
      format: 'chaski.templates',
      version: 1,
      templates: [
        {
          type: 'payment_received',
          channels: [{ channel: 'email', enabled: true, body: UNCLOSED }],
        },
      ],
    };

    for (const preview of [true, false]) {
      await expect(chaski.templates.import(file, { preview })).rejects.toMatchObject({
        code: 'validation',
        message: expect.stringMatching(/^payment_received email body: /),
      });
    }
  });

  it('answers the preview with the reason', async () => {
    const response = await api(`/templates/${await templateId()}/preview`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'email', data: {}, content: { body: UNCLOSED } }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'validation',
      message: expect.stringMatching(/^body: .*not closed/),
    });
  });

  it('shows the reason inside the email preview frame, escaped', async () => {
    const response = await api(`/templates/${await templateId()}/preview/document`, {
      method: 'POST',
      body: new URLSearchParams({ body: UNCLOSED, data: '{}' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    const html = await response.text();
    expect(html).toContain('not closed');
    expect(html).toContain('&#60;/p&#62;');
    expect(html).not.toContain('</p>');
  });

  it('fails a delivery on its first attempt instead of retrying it', async () => {
    await getClient().templateChannels.updateMany({
      where: { channel: 'email' },
      data: { body: UNCLOSED },
    });
    const { notificationId } = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 10 },
    });

    await processDeliveries(notificationId);

    const email = await getClient().deliveries.findFirst({
      where: { notificationId, channel: 'email' },
    });
    expect(email).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'validation' });
    expect(email?.lastError).toMatch(/^Liquid: .*not closed/);
  });
});
