import { RpcTarget, WorkerEntrypoint } from 'cloudflare:workers';
import type {
  ChaskiApi,
  ChaskiFeedApi,
  ChaskiPreferencesApi,
  ChaskiPushApi,
  ChaskiSchedulesApi,
} from '../contract/api';
import type {
  CancelScheduledQuery,
  ListFeedQuery,
  MarkFeedReadInput,
  PreferencesUpdate,
  RegisterPushSubscriptionRequest,
  ScheduleRequest,
  SendRequest,
  UnregisterPushSubscriptionQuery,
} from '../contract/contract';
import { api } from './api';

class Schedules extends RpcTarget implements ChaskiSchedulesApi {
  list(query?: { recipientId?: string }) {
    return api.schedules.list(query);
  }
  cancel(query: CancelScheduledQuery) {
    return api.schedules.cancel(query);
  }
}

class Push extends RpcTarget implements ChaskiPushApi {
  register(request: RegisterPushSubscriptionRequest) {
    return api.push.register(request);
  }
  unregister(query: UnregisterPushSubscriptionQuery) {
    return api.push.unregister(query);
  }
  vapidPublicKey() {
    return api.push.vapidPublicKey();
  }
}

class Preferences extends RpcTarget implements ChaskiPreferencesApi {
  get(recipientId: string) {
    return api.preferences.get(recipientId);
  }
  set(recipientId: string, update: PreferencesUpdate) {
    return api.preferences.set(recipientId, update);
  }
  topics() {
    return api.preferences.topics();
  }
}

class Feed extends RpcTarget implements ChaskiFeedApi {
  list(query: ListFeedQuery) {
    return api.feed.list(query);
  }
  unreadCount(recipientId: string) {
    return api.feed.unreadCount(recipientId);
  }
  markRead(input: MarkFeedReadInput) {
    return api.feed.markRead(input);
  }
}

/**
 * The in-process API over RPC, for the host's other Workers; only Workers in the
 * host's account can bind to it. A service binding sees methods, never getters,
 * so each group is a method: env.CHASKI.feed().list(query), still one round trip.
 */
export class ChaskiEntrypoint
  extends WorkerEntrypoint
  implements Pick<ChaskiApi, 'send' | 'schedule'>
{
  send(request: SendRequest) {
    return api.send(request);
  }

  schedule(request: ScheduleRequest) {
    return api.schedule(request);
  }

  schedules() {
    return new Schedules();
  }

  push() {
    return new Push();
  }

  preferences() {
    return new Preferences();
  }

  feed() {
    return new Feed();
  }
}
