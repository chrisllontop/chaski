import { Hono } from 'hono';
import * as chaski from '../../src';

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
