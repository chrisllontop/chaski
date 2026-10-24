import { exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { injectOpenPixel, openPixelUrl } from '../src/server/lib/email-open';
import { DeliveryService } from '../src/server/services/delivery.service';
import { NotificationService } from '../src/server/services/notification.service';
import { recipient, seedTemplate } from './helpers';

const createEmailDelivery = async (status = 'sent') => {
  await seedTemplate('payment_received', 'email');
  const result = await NotificationService.send({
    type: 'payment_received',
    recipient: recipient(),
    payload: { amount: 10 },
  });
  const delivery = await getClient().deliveries.findFirst({
    where: { notificationId: result.notificationId, channel: 'email' },
  });
  if (!delivery) throw new Error('email delivery row missing');
  await getClient().deliveries.update({ where: { id: delivery.id }, data: { status } });
  return delivery.id;
};

const openedAt = async (deliveryId: string) =>
  (await getClient().deliveries.findFirst({ where: { id: deliveryId } }))?.openedAt;

describe('DeliveryService.markOpened', () => {
  it('stamps openedAt without changing status', async () => {
    const deliveryId = await createEmailDelivery('sent');

    await DeliveryService.markOpened(deliveryId);

    const row = await getClient().deliveries.findFirst({ where: { id: deliveryId } });
    expect(row?.openedAt).toBeTruthy();
    expect(row?.status).toBe('sent');
  });

  it('keeps the first openedAt on re-opens', async () => {
    const deliveryId = await createEmailDelivery('sent');

    await DeliveryService.markOpened(deliveryId);
    const first = await openedAt(deliveryId);
    await DeliveryService.markOpened(deliveryId);

    expect((await openedAt(deliveryId))?.getTime()).toBe(first?.getTime());
  });

  it('does not change non-sent statuses', async () => {
    const deliveryId = await createEmailDelivery('failed');

    await DeliveryService.markOpened(deliveryId);

    const row = await getClient().deliveries.findFirst({ where: { id: deliveryId } });
    expect(row?.status).toBe('failed');
    expect(row?.openedAt).toBeTruthy();
  });

  it('is a silent no-op for unknown delivery ids', async () => {
    await expect(DeliveryService.markOpened('d_missing')).resolves.toBe(false);
  });
});

describe('GET /t/o/:deliveryId', () => {
  it('answers the pixel without credentials and records the open', async () => {
    const deliveryId = await createEmailDelivery('sent');

    const response = await exports.default.fetch(`https://host.test/chaski/t/o/${deliveryId}`, {
      headers: { 'x-fixture-authorize': 'deny' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/gif');
    expect(response.headers.get('cache-control')).toContain('no-store');
    await vi.waitFor(async () => expect(await openedAt(deliveryId)).toBeTruthy());
  });

  it('answers the pixel for an unknown delivery too', async () => {
    const response = await exports.default.fetch('https://host.test/chaski/t/o/d_missing');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/gif');
  });
});

describe('open pixel helpers', () => {
  it('builds the pixel URL without duplicate slashes', () => {
    expect(openPixelUrl('https://chaski.example/', 'd_1')).toBe('https://chaski.example/t/o/d_1');
  });

  it('injects the pixel before </body> when present, appends otherwise', () => {
    const withBody = injectOpenPixel('<html><body><p>hi</p></body></html>', 'https://x/t/o/1');
    expect(withBody).toContain('src="https://x/t/o/1"');
    expect(withBody.indexOf('img')).toBeLessThan(withBody.indexOf('</body>'));

    const withoutBody = injectOpenPixel('<p>hi</p>', 'https://x/t/o/1');
    expect(withoutBody.endsWith('/>')).toBe(true);
    expect(withoutBody).toContain('<p>hi</p>');
  });
});
