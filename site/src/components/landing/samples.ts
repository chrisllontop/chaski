export const sendSample = `await env.CHASKI.send({
  type: 'payment_received',
  recipient: { id: user.id, email: user.email },
  payload: { amount: '$15.00' },
});`;

export const wranglerSample = `{
  "name": "chaski",
  "main": "src/index.ts",
  "d1_databases": [
    {
      "binding": "CHASKI_DB",
      "database_name": "chaski",
      "database_id": "<printed by wrangler d1 create>",
      // Chaski's tables come from the package.
      "migrations_dir": "node_modules/chaskijs/migrations"
    }
  ],
  "queues": {
    "producers": [
      { "binding": "CHASKI_QUEUE", "queue": "chaski-deliveries" }
    ],
    "consumers": [
      {
        "queue": "chaski-deliveries",
        "max_retries": 5,
        "dead_letter_queue": "chaski-deliveries-dlq"
      }
    ]
  },
  "send_email": [{ "name": "CHASKI_EMAIL" }]
}`;

export const indexSample = `// The whole Chaski Worker: the dashboard, the queue
// consumer and the API your app calls.
export {
  ChaskiEntrypoint,
  ChaskiEvents,
  ChaskiFeed,
  ChaskiScheduler,
  default,
} from 'chaskijs/worker';`;

export const billingSample = `// Bound to Chaski in wrangler.jsonc:
// { "binding": "CHASKI", "service": "chaski",
//   "entrypoint": "ChaskiEntrypoint" }
export const sendReceipt = async (env: Env, user: User, payment: Payment) => {
  await env.CHASKI.send({
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
