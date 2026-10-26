import type { ChaskiApi } from '../contract/api';
import { resolveConfig } from './config';
import { ready } from './migrations';
import { FeedService } from './services/feed.service';
import { NotificationService } from './services/notification.service';
import { PreferenceService } from './services/preference.service';
import { PushSubscriptionService } from './services/push-subscription.service';
import { ScheduleService } from './services/schedule.service';

const run =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    await ready();
    return fn(...args);
  };

/** The in-process API, shared by createChaski() and the ChaskiEntrypoint RPC surface. */
export const api: ChaskiApi = {
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
