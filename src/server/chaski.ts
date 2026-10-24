import type { Env, Hono } from 'hono';
import { type ChaskiConfig, setConfigure } from './config';
import { mountRoutes, type RoutesOptions } from './routes';

export type Chaski = {
  /** The dashboard and its admin API under /api; mount it with app.route(). */
  routes<E extends Env = Env>(options: RoutesOptions<E>): Hono<E>;
};

/** Call once in the Worker's main module; `configure` receives the Worker env on every call. */
export const createChaski = <E>(configure: (env: E) => ChaskiConfig): Chaski => {
  setConfigure(configure);
  return {
    routes: (options) => mountRoutes(options),
  };
};
