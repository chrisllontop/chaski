import { type Context, type Env, Hono, type MiddlewareHandler } from 'hono';
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
import { handleError, requireReady, sameOrigin } from './http';

/**
 * Says who is signed in: the recipient id Chaski keys their feed, devices and
 * preferences by. null answers 401, and a Response is returned as is.
 */
export type Identify<E extends Env = Env> = (
  c: Context<E>,
) => string | null | Response | Promise<string | null | Response>;

export type UserRoutesOptions<E extends Env = Env> = {
  identify: Identify<E>;
  /**
   * Origins of the host's own frontend, when it lives on another origin than
   * these routes; writes and socket upgrades from any other origin are refused.
   */
  allowedOrigins?: string[];
  /**
   * The groups of routes this mount serves, all three by default. A shared inbox serves the
   * feed alone: a browser belongs to one contact, so registering it there would take it from
   * the user's own inbox. A host with a preferences API of its own leaves `preferences` out.
   */
  groups?: UserRouteGroup[];
  /** Whether the signed-in contact may register a device; false answers 403. */
  allowPush?: (c: Context<E>, recipientId: string) => boolean | Promise<boolean>;
};

export const USER_ROUTE_GROUPS = ['feed', 'push', 'preferences'] as const;
export type UserRouteGroup = (typeof USER_ROUTE_GROUPS)[number];

const recipients = new WeakMap<Request, string>();

const recipientOf = (c: Context): string => {
  const recipientId = recipients.get(c.req.raw);
  if (!recipientId) throw new Error('identify did not run before a user route');
  return recipientId;
};

const identified =
  <E extends Env>(identify: Identify<E>): MiddlewareHandler<E> =>
  async (c, next) => {
    const verdict = await identify(c);
    if (verdict instanceof Response) return verdict;
    c.header('Cache-Control', 'no-store');
    if (typeof verdict !== 'string' || verdict.length === 0 || verdict.length > 256) {
      return c.json({ error: 'unauthorized', message: 'not signed in' }, 401);
    }
    recipients.set(c.req.raw, verdict);
    return next();
  };

// A missing or unreadable body must not count as `{}`, which means "all of
// them" to the feed's mark-read.
const jsonBody = async (c: Context): Promise<unknown> => {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) throw new ChaskiError('validation', 'the body must be JSON');
  return body;
};

// Not chained, like mountRoutes: chaining rewrites the app's type.
export const mountUserRoutes = <E extends Env = Env>({
  identify,
  allowedOrigins,
  groups = [...USER_ROUTE_GROUPS],
  allowPush,
}: UserRoutesOptions<E>): Hono<E> => {
  const serves = new Set<UserRouteGroup>(groups);
  const app = new Hono<E>();
  app.onError(handleError);
  app.use(sameOrigin(allowedOrigins));
  app.use(identified(identify));
  app.use(requireReady);

  if (serves.has('push')) {
    app.get('/push/vapid-public-key', (c) =>
      c.json({ publicKey: resolveConfig().channels.push?.vapid?.publicKey ?? null }),
    );

    app.post('/push/subscriptions', async (c) => {
      const device = parseInput(deviceSubscriptionSchema, await jsonBody(c));
      const recipient = { id: recipientOf(c) };
      if (allowPush && !(await allowPush(c, recipient.id))) {
        return c.json(
          { error: 'forbidden', message: 'this contact may not register devices' },
          403,
        );
      }
      const userAgent = c.req.header('user-agent')?.slice(0, 512);
      const request =
        'deviceToken' in device
          ? { recipient, platform: device.platform, deviceToken: device.deviceToken, userAgent }
          : { recipient, subscription: device, userAgent };
      return c.json(await PushSubscriptionService.register(request), 201);
    });

    // Scoped to the signed-in recipient, so nobody can drop another's device.
    app.delete('/push/subscriptions', async (c) => {
      const device = parseInput(deviceUnsubscriptionSchema, await jsonBody(c));
      return c.json(
        await PushSubscriptionService.unregister({ ...device, recipientId: recipientOf(c) }),
      );
    });
  }

  if (serves.has('feed')) {
    app.get('/feed', async (c) => {
      const params = parseInput(feedListParamsSchema, c.req.query());
      return c.json(await FeedService.list({ ...params, recipientId: recipientOf(c) }));
    });

    app.get('/feed/unread-count', async (c) =>
      c.json(await FeedService.unreadCount(recipientOf(c))),
    );

    app.post('/feed/read', async (c) => {
      const body = parseInput(markFeedReadBodySchema, await jsonBody(c));
      return c.json(await FeedService.markRead({ ...body, recipientId: recipientOf(c) }));
    });

    // The 101 must pass through untouched, so no middleware may rewrite it.
    app.get('/feed/socket', async (c) => {
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
        return c.json({ error: 'upgrade_required', message: 'expected a WebSocket upgrade' }, 426);
      }
      return feedStub(recipientOf(c)).fetch(c.req.raw);
    });
  }

  if (serves.has('preferences')) {
    app.get('/preferences', async (c) => c.json(await PreferenceService.get(recipientOf(c))));

    app.patch('/preferences', async (c) =>
      c.json(await PreferenceService.set(recipientOf(c), await jsonBody(c))),
    );

    app.get('/preferences/topics', async (c) => c.json(await PreferenceService.topics()));
  }

  app.all('*', (c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404));
  return app;
};
