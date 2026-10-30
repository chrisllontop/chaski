import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { RECIPIENT_HEADER } from '../../contract/api';
import {
  deviceSubscriptionSchema,
  deviceUnsubscriptionSchema,
  feedListParamsSchema,
  markFeedReadBodySchema,
} from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { resolveConfig } from '../config';
import { feedStub } from '../durable/feed';
import { parseInput } from '../lib/validate';
import { FeedService } from '../services/feed.service';
import { PreferenceService } from '../services/preference.service';
import { PushSubscriptionService } from '../services/push-subscription.service';
import { handleError, requireReady } from './http';

const recipients = new WeakMap<Request, string>();

const DEVICE_ID = /^dt_[0-9A-Za-z]{16}$/;

const recipientOf = (c: Context): string => {
  const recipientId = recipients.get(c.req.raw);
  if (!recipientId) throw new Error('the recipient check did not run before a user route');
  return recipientId;
};

// Only a service binding reaches ChaskiEntrypoint, so the header comes from the app's
// userRoutes(), which identified the contact and never forwards the browser's own copy.
const identified: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const recipientId = c.req.header(RECIPIENT_HEADER);
  if (!recipientId || recipientId.length > 256) {
    return c.json({ error: 'unauthorized', message: 'not signed in' }, 401);
  }
  recipients.set(c.req.raw, recipientId);
  return next();
};

// A missing or unreadable body must not count as `{}`, which means "all of
// them" to the feed's mark-read.
const jsonBody = async (c: Context): Promise<unknown> => {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) throw new ChaskiError('validation', 'the body must be JSON');
  return body;
};

/**
 * Feed, devices and preferences of the contact the app signed in, over the service binding. The
 * app's userRoutes() decides which of them its frontend reaches, and from which origins.
 */
// Not chained: chaining rewrites the app's type.
export const userRoutes = new Hono();
userRoutes.onError(handleError);
userRoutes.use(identified, requireReady);

userRoutes.get('/push/vapid-public-key', (c) =>
  c.json({ publicKey: resolveConfig().channels.push?.vapid?.publicKey ?? null }),
);

userRoutes.post('/push/subscriptions', async (c) => {
  const device = parseInput(deviceSubscriptionSchema, await jsonBody(c));
  const recipient = { id: recipientOf(c) };
  const userAgent = c.req.header('user-agent')?.slice(0, 512);
  const request =
    'platform' in device
      ? { ...device, recipient, userAgent }
      : { recipient, subscription: device, userAgent };
  return c.json(await PushSubscriptionService.register(request), 201);
});

// Scoped to the signed-in recipient, so nobody can drop another's device.
userRoutes.delete('/push/subscriptions', async (c) => {
  const device = parseInput(deviceUnsubscriptionSchema, await jsonBody(c));
  return c.json(
    await PushSubscriptionService.unregister({ ...device, recipientId: recipientOf(c) }),
  );
});

userRoutes.get('/feed', async (c) => {
  const params = parseInput(feedListParamsSchema, c.req.query());
  return c.json(await FeedService.list({ ...params, recipientId: recipientOf(c) }));
});

userRoutes.get('/feed/unread-count', async (c) =>
  c.json(await FeedService.unreadCount(recipientOf(c))),
);

userRoutes.post('/feed/read', async (c) => {
  const body = parseInput(markFeedReadBodySchema, await jsonBody(c));
  return c.json(await FeedService.markRead({ ...body, recipientId: recipientOf(c) }));
});

// The 101 must pass through untouched, so no middleware may rewrite it. `device` names a device
// the client registered: while this socket is open, its pushes come through the feed. The socket
// belongs to the signed-in recipient, so a device of anyone else changes nothing.
userRoutes.get('/feed/socket', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'upgrade_required', message: 'expected a WebSocket upgrade' }, 426);
  }
  const device = c.req.query('device');
  if (device !== undefined && !DEVICE_ID.test(device)) {
    throw new ChaskiError('validation', 'device must be the id registering the device returned');
  }
  return feedStub(recipientOf(c)).fetch(c.req.raw);
});

userRoutes.get('/preferences', async (c) => c.json(await PreferenceService.get(recipientOf(c))));

userRoutes.patch('/preferences', async (c) =>
  c.json(await PreferenceService.set(recipientOf(c), await jsonBody(c))),
);

userRoutes.get('/preferences/topics', async (c) => c.json(await PreferenceService.topics()));

userRoutes.all('*', (c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404));
