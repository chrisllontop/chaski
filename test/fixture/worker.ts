import { Hono } from 'hono';
import { createChaski } from '../../src';

export type FixtureEnv = {
  CHASKI_DB: D1Database;
};

export const chaski = createChaski((env: FixtureEnv) => ({
  bindings: { db: env.CHASKI_DB },
}));

// Tests pick the authorize verdict per request; the browser gets the default and sees the dashboard.
const dashboard = chaski.routes({
  dashboard: {
    authorize: (c) => {
      const verdict = c.req.header('x-fixture-authorize');
      if (verdict === 'deny') {
        return false;
      }
      if (verdict === 'redirect') {
        return c.redirect('/login', 302);
      }
      return true;
    },
  },
});

export default new Hono()
  .get('/', (c) => c.text('Host home'))
  .route('/chaski', dashboard)
  .route('/admin', new Hono().route('/notifications', dashboard));
