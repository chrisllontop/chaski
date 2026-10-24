import { Hono } from 'hono';
import { TRANSPARENT_GIF } from '../lib/email-open';
import { logger } from '../lib/log';
import { reportError } from '../lib/report-error';
import { DeliveryService } from '../services/delivery.service';

// Public, unauthenticated: mail clients and proxies (e.g. Gmail's image cache)
// fetch the pixel with no credentials. The response is always the GIF — the DB
// write runs in waitUntil and any failure must never surface to the client.
export const tracking = new Hono();

tracking.get('/o/:deliveryId', (c) => {
  const deliveryId = c.req.param('deliveryId');
  c.executionCtx.waitUntil(
    DeliveryService.markOpened(deliveryId).catch((error: unknown) => {
      reportError(error, { source: 'tracking', deliveryId });
      logger('tracking').error('open mark failed', error, { deliveryId });
    }),
  );
  return c.body(TRANSPARENT_GIF.slice().buffer, 200, {
    'content-type': 'image/gif',
    'cache-control': 'no-store, no-cache, must-revalidate, private',
    expires: '0',
  });
});
