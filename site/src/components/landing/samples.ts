export const sendSample = `await chaski.send({
  type: 'payment_received',
  recipient: { id: user.id, email: user.email },
  payload: { amount: '$15.00' },
});`;

export const wranglerSample = `{
  "vars": {
    "CHASKI_PUBLIC_URL": "https://acme.dev/admin/notifications"
  },
  "d1_databases": [
    {
      "binding": "CHASKI_DB",
      "database_name": "acme-chaski",
      "database_id": "<printed by wrangler d1 create>",
      // Chaski's tables come from the package.
      "migrations_dir": "node_modules/chaski/migrations"
    }
  ],
  "queues": {
    "producers": [
      { "binding": "CHASKI_QUEUE", "queue": "acme-deliveries" }
    ],
    "consumers": [
      {
        "queue": "acme-deliveries",
        "max_retries": 5,
        "dead_letter_queue": "acme-deliveries-dlq"
      }
    ]
  },
  "send_email": [{ "name": "CHASKI_EMAIL" }]
}`;

export const indexSample = `import { cloudflareAccess, createChaski } from 'chaski';

export const chaski = createChaski((env: Env) => ({
  publicUrl: env.CHASKI_PUBLIC_URL,
  bindings: {
    db: env.CHASKI_DB,
    queue: env.CHASKI_QUEUE,
    email: env.CHASKI_EMAIL,
  },
  channels: { email: { from: 'hi@acme.dev' } },
}));

// The dashboard, for your team.
app.route('/admin/notifications', chaski.routes({
  dashboard: { authorize: cloudflareAccess({ teamDomain, audience }) },
}));
// The feed and preferences, for your signed-in users.
app.route('/me/notifications', chaski.userRoutes({ identify }));

export default {
  fetch: app.fetch,
  queue: async (batch, env, ctx) => {
    await chaski.queue(batch, env, ctx);
  },
};`;

export const billingSample = `import { chaski } from './index';

export const sendReceipt = async (user: User, payment: Payment) => {
  await chaski.send({
    type: 'payment_received',
    recipient: { id: user.id, email: user.email, name: user.name },
    payload: { amount: payment.amount },
    // A retried request with the same key sends only once.
    idempotencyKey: \`payment:\${payment.id}\`,
  });
};`;

export const rpcSample = `await env.CHASKI.send({
  type: 'order_shipped',
  recipient: { id: order.userId },
});`;
