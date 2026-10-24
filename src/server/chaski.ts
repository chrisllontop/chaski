import type { Env, Hono } from 'hono';
import type { ChaskiApi } from '../contract/api';
import { type ChaskiConfig, resolveConfig, setConfigure } from './config';
import { handleQueueBatch, isChaskiBatch } from './consumer';
import { ready } from './migrations';
import { mountRoutes, type RoutesOptions } from './routes';
import { FeedService } from './services/feed.service';
import { NotificationService } from './services/notification.service';
import { PreferenceService } from './services/preference.service';
import { PushSubscriptionService } from './services/push-subscription.service';
import { ScheduleService } from './services/schedule.service';

export type Chaski = ChaskiApi & {
  /** The dashboard, its admin API under /api and the open-tracking pixel; mount it with app.route(). */
  routes<E extends Env = Env>(options: RoutesOptions<E>): Hono<E>;
  /** Handles a batch from chaski's queue and returns true; leaves any other batch untouched. */
  queue(batch: MessageBatch<unknown>, env?: unknown, ctx?: ExecutionContext): Promise<boolean>;
};

const run =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    await ready();
    return fn(...args);
  };

/** Call once in the Worker's main module; `configure` receives the Worker env on every call. */
export const createChaski = <E>(configure: (env: E) => ChaskiConfig): Chaski => {
  setConfigure(configure);
  return {
    routes: (options) => mountRoutes(options),
    queue: async (batch) => {
      if (!isChaskiBatch(batch)) return false;
      await ready();
      await handleQueueBatch(batch);
      return true;
    },
    send: run((request) => NotificationService.send(request)),
    schedule: run((request) => ScheduleService.schedule(request)),
    schedules: {
      list: run((query = {}) => ScheduleService.listPending(query.recipientId)),
      cancel: run((query) => ScheduleService.cancel(query)),
    },
    push: {
      register: run((request) => PushSubscriptionService.register(request)),
      unregister: run((query) => PushSubscriptionService.unregister(query)),
      vapidPublicKey: async () => ({
        publicKey: resolveConfig().channels.push?.vapid?.publicKey ?? null,
      }),
    },
    preferences: {
      get: run((recipientId) => PreferenceService.get(recipientId)),
      set: run((recipientId, update) => PreferenceService.set(recipientId, update)),
      topics: run(() => PreferenceService.topics()),
    },
    feed: {
      list: run((query) => FeedService.list(query)),
      unreadCount: run((recipientId) => FeedService.unreadCount(recipientId)),
      markRead: run((input) => FeedService.markRead(input)),
    },
  };
};
