import type { Env, Hono } from 'hono';
import type { ChaskiApi } from '../contract/api';
import { type ChaskiConfig, setConfigure } from './config';
import { handleQueueBatch, isChaskiBatch } from './consumer';
import { ready } from './migrations';
import { mountRoutes, type RoutesOptions } from './routes';
import { NotificationService } from './services/notification.service';

export type Chaski = ChaskiApi & {
  /** The dashboard and its admin API under /api; mount it with app.route(). */
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
  };
};
