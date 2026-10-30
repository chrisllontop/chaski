export const sendSample = `await env.CHASKI.send({
  type: 'payment_received',
  recipient: { id: user.id, email: user.email },
  payload: { amount: '$15.00' },
});`;

// The commands' own output, as of chaskijs 0.1, trimmed to 26 lines so that with the shell's next
// prompt they fill the panel's 27: what npm and Wrangler print is left out, and so are deploy's
// notes between its steps. The terminal plays them back line by line (terminal.tsx).
export const initSample = `$ npx chaskijs init
? Where should the Chaski project live?
  1. A folder of this repository
  2. A new repository
  Choose 1-2: 1
? Directory (chaski):
? Worker name (chaski):
? Send email? It needs Workers Paid and a domain on Email Service. (Y/n)
? Email attachments? They need an R2 bucket. (y/N)
? Your app's userRoutes() URL, for the email open pixel (optional):

Created chaski/ with:
  package.json
  wrangler.jsonc
  src/index.ts
  .gitignore
  .dev.vars

Installing the dependencies with npm…

Applying the migrations to the local database…

Next:
  cd chaski
  npx wrangler dev      Runs it, the dashboard at http://localhost:8787
  npx chaskijs deploy   Creates its resources and deploys it`;

export const deploySample = `$ npx chaskijs deploy
Checking what chaski needs in your Cloudflare account…

To deploy chaski, chaskijs will:
  Create the D1 database chaski
  Create the queue chaski-deliveries
  Create the queue chaski-deliveries-dlq
  Apply the migrations to chaski
  Deploy the Worker chaski, with a new CHASKI_SECRET

? Go ahead? (y/N) y

→ Create the D1 database chaski
→ Create the queue chaski-deliveries
→ Create the queue chaski-deliveries-dlq
→ Apply the migrations to chaski
→ Deploy the Worker chaski, with a new CHASKI_SECRET

Chaski is live at https://chaski.example.workers.dev

Two steps are yours:
  1. Turn on Cloudflare Access. In the Cloudflare dashboard, open the
     Worker chaski, go to Settings › Domains & Routes and select Enable
     Cloudflare Access on its workers.dev URL. Use that switch, not the
     Worker's own Access tab: it refuses the dashboard's live updates.
  2. Set up the channels on the Channels page, at the URL above.`;

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
