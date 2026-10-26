import type { Env, Hono } from 'hono';
import type { ChaskiApi } from '../contract/api';
import { api } from './api';
import { type ChaskiConfig, setConfigure } from './config';
import { handleQueueBatch, isChaskiBatch } from './consumer';
import { ready } from './migrations';
import { mountRoutes, type RoutesOptions } from './routes';
import { mountUserRoutes, type UserRoutesOptions } from './routes/user';

export type Chaski = ChaskiApi & {
  /** The dashboard, its admin API under /api and the open-tracking pixel; mount it with app.route(). */
  routes<E extends Env = Env>(options: RoutesOptions<E>): Hono<E>;
  /** Feed, devices and preferences of the signed-in user, for the host's frontend; mount it with app.route(). */
  userRoutes<E extends Env = Env>(options: UserRoutesOptions<E>): Hono<E>;
  /** Handles a batch from Chaski's queue and returns true; leaves any other batch untouched. */
  queue(batch: MessageBatch<unknown>, env?: unknown, ctx?: ExecutionContext): Promise<boolean>;
};

/** Call once in the Worker's main module; `configure` receives the Worker env on every call. */
export const createChaski = <E>(configure: (env: E) => ChaskiConfig): Chaski => {
  setConfigure(configure);
  return {
    ...api,
    routes: (options) => mountRoutes(options),
    userRoutes: (options) => mountUserRoutes(options),
    queue: async (batch) => {
      if (!isChaskiBatch(batch)) return false;
      await ready();
      await handleQueueBatch(batch);
      return true;
    },
  };
};
