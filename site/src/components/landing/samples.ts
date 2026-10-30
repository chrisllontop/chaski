export const sendSample = `await env.CHASKI.send({
  type: 'payment_received',
  recipient: { id: user.id, email: user.email },
  payload: { amount: '$15.00' },
});`;

export const initSample = `$ npx chaskijs init

? Where should Chaski live?
› A folder of this repository
  A new repository

✓ Wrote chaski/package.json
✓ Wrote chaski/wrangler.jsonc
✓ Wrote chaski/src/index.ts
✓ Applied the migrations locally

Next: npx chaskijs deploy`;

export const deploySample = `$ npx chaskijs deploy

✓ Created the database
✓ Created the queues
✓ Applied the migrations
✓ Deployed chaski

Your dashboard is at
https://chaski.acme.workers.dev
Set up the channels there.`;

export const appSample = `// Bound in wrangler.jsonc:
// { "binding": "CHASKI", "service": "chaski",
//   "entrypoint": "ChaskiEntrypoint" }
import { Hono } from 'hono';
import { userRoutes } from 'chaskijs';

const app = new Hono<{ Bindings: Env }>();

// The signed-in user's feed, devices and preferences.
app.route(
  '/me/notifications',
  userRoutes({
    chaski: (c) => c.env.CHASKI,
    identify: (c) => currentUserId(c),
  }),
);

app.post('/payments', async (c) => {
  const payment = await charge(c);
  await c.env.CHASKI.send({
    type: 'payment_received',
    recipient: { id: payment.userId },
    payload: { amount: payment.amount },
    idempotencyKey: \`payment:\${payment.id}\`,
  });
  return c.json(payment);
});`;

export const rpcSample = `await env.CHASKI.send({
  type: 'order_shipped',
  recipient: { id: order.userId },
});`;
