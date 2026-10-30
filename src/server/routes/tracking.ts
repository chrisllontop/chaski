import { Hono } from 'hono';
import { publishAdminEvents } from '../lib/admin-events';
import { TRANSPARENT_GIF } from '../lib/email-open';
import { logger } from '../lib/log';
import { DeliveryService } from '../services/delivery.service';

// The app forwards the pixel without identifying anyone: mail clients and proxies (Gmail's image
// cache, say) fetch it with no credentials. The response is always the GIF; the write runs in
// waitUntil and its failure never reaches the client.
export const tracking = new Hono();

tracking.get('/o/:deliveryId', (c) => {
  const deliveryId = c.req.param('deliveryId');
  c.executionCtx.waitUntil(
    DeliveryService.markOpened(deliveryId)
      .then((opened) => (opened ? publishAdminEvents(['deliveries', 'metrics']) : undefined))
      .catch((error: unknown) => {
        logger('tracking').error('open mark failed', error, { deliveryId });
      }),
  );
  return c.body(TRANSPARENT_GIF.slice().buffer, 200, {
    'content-type': 'image/gif',
    'cache-control': 'no-store, no-cache, must-revalidate, private',
    expires: '0',
  });
});
