import { RpcTarget, WorkerEntrypoint } from 'cloudflare:workers';
import { Hono } from 'hono';
import type {
  ChaskiApi,
  ChaskiFeedApi,
  ChaskiPreferencesApi,
  ChaskiPushApi,
  ChaskiSchedulesApi,
  ChaskiTemplatesApi,
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
import { tracking } from './routes/tracking';
import { userRoutes } from './routes/user';

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

class Templates extends RpcTarget implements ChaskiTemplatesApi {
  import(file: unknown, options?: { preview?: boolean }) {
    return api.templates.import(file, options);
  }
  export() {
    return api.templates.export();
  }
}

// The open pixel first: mail clients load it with no session, so it names no recipient.
const routes = new Hono().route('/t', tracking).route('/', userRoutes);

/**
 * Chaski's API over RPC, plus the routes the app's userRoutes() forwards; only Workers in the same
 * account can bind to it. A service binding sees methods, never getters, so each group is a
 * method: env.CHASKI.feed().list(query), still one round trip.
 */
export class ChaskiEntrypoint
  extends WorkerEntrypoint
  implements Pick<ChaskiApi, 'ready' | 'send' | 'schedule'>
{
  override fetch(request: Request) {
    return routes.fetch(request, this.env, this.ctx);
  }

  ready() {
    return api.ready();
  }

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

  templates() {
    return new Templates();
  }
}
