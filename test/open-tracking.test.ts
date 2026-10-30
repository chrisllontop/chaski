import { env, exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { userRoutes } from '../src/app/user-routes';
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
  it('stamps openedAt without changing status or updatedAt', async () => {
    const deliveryId = await createEmailDelivery('sent');
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    // Straight SQL: the client's timestamps plugin would stamp updatedAt with now.
    await env.CHASKI_DB.prepare('UPDATE deliveries SET updated_at = ? WHERE id = ?')
      .bind(updatedAt.getTime(), deliveryId)
      .run();

    await DeliveryService.markOpened(deliveryId);

    const row = await getClient().deliveries.findFirst({ where: { id: deliveryId } });
    expect(row?.openedAt).toBeTruthy();
    expect(row?.status).toBe('sent');
    expect(row?.updatedAt.toISOString()).toBe(updatedAt.toISOString());
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

// The fixture mounts the app's userRoutes() at /app/notifications, as CHASKI_PUBLIC_URL says.
describe('GET /t/o/:deliveryId', () => {
  it('answers the pixel through the app without a session and records the open', async () => {
    const deliveryId = await createEmailDelivery('sent');

    const response = await exports.default.fetch(
      `https://app.test/app/notifications/t/o/${deliveryId}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/gif');
    expect(response.headers.get('cache-control')).toContain('no-store');
    await vi.waitFor(async () => expect(await openedAt(deliveryId)).toBeTruthy());
  });

  it('answers the pixel for an unknown delivery too', async () => {
    const response = await exports.default.fetch(
      'https://app.test/app/notifications/t/o/d_missing',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/gif');
  });

  // An app that gates its routes behind a session mounts the pixel alone ahead of the gate.
  it('serves the pixel from a mount with no groups, ahead of the app gates', async () => {
    const deliveryId = await createEmailDelivery('sent');
    const app = new Hono();
    const chaski = () => exports.ChaskiEntrypoint;
    app.route('/n', userRoutes({ chaski, identify: () => null, groups: [] }));
    app.use('*', (c) => c.json({ error: 'unauthorized' }, 401));
    app.route('/n', userRoutes({ chaski, identify: () => 'user_1' }));

    const pixel = await app.request(`https://app.test/n/t/o/${deliveryId}`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    const feed = await app.request('https://app.test/n/feed');

    expect(pixel.status).toBe(200);
    expect(pixel.headers.get('content-type')).toBe('image/gif');
    expect(feed.status).toBe(401);
    await vi.waitFor(async () => expect(await openedAt(deliveryId)).toBeTruthy());
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
