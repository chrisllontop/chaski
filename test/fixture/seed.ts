import type { Chaski, TemplateFile } from '../../src';

// Sample data for `pnpm dev`, so the dashboard has something to show. It goes
// in through the doors a host uses: the in-process API for templates, sends
// and schedules.

const TEMPLATES: TemplateFile = {
  format: 'chaski.templates',
  version: 1,
  templates: [
    {
      type: 'payment_received',
      description: 'A payment cleared',
      topic: 'billing',
      sampleData: '{"amount": 1500, "recipient": {"name": "Ana"}}',
      channels: [
        {
          channel: 'email',
          enabled: true,
          subject: 'We received {{ amount }}',
          body: '<h1 style="font-family:sans-serif">Thanks, {{ recipient.name }}</h1><p style="font-family:sans-serif">We received your payment of <strong>{{ amount }}</strong>.</p>',
          textBody: 'We received your payment of {{ amount }}.',
        },
        {
          channel: 'in_app',
          enabled: true,
          subject: 'Payment received',
          body: 'We received {{ amount }}.',
          textBody: '/payments',
        },
      ],
    },
    {
      type: 'invoice_due',
      description: 'An invoice is about to fall due',
      topic: 'billing',
      sampleData: '{"invoice": "INV-1042", "due": "Feb 20"}',
      channels: [
        {
          channel: 'email',
          enabled: true,
          subject: 'Invoice {{ invoice }} is due {{ due }}',
          body: '<p style="font-family:sans-serif">Invoice {{ invoice }} is due {{ due }}.</p>',
        },
        {
          channel: 'push',
          enabled: true,
          subject: 'Invoice due',
          body: '{{ invoice }} is due {{ due }}',
          textBody: '/invoices',
        },
      ],
    },
    {
      type: 'welcome',
      description: 'Sent once, after sign-up',
      topic: null,
      channels: [
        {
          channel: 'email',
          enabled: true,
          subject: 'Welcome, {{ recipient.name }}',
          body: '<p style="font-family:sans-serif">Welcome aboard.</p>',
        },
        { channel: 'in_app', enabled: true, subject: 'Welcome', body: 'Your account is ready.' },
      ],
    },
  ],
};

const NAMES = ['Ana', 'Luis', 'Marta', 'Jo', 'Sam', 'Noor', 'Kim', 'Leo'];
const TYPES = ['payment_received', 'invoice_due', 'welcome'] as const;

export const seed = async (chaski: Chaski) => {
  await chaski.templates.import(TEMPLATES);
  let sent = 0;
  for (let i = 0; i < 40; i++) {
    const name = NAMES[i % NAMES.length] ?? 'Ana';
    const id = `user_${String(1000 + i)}`;
    await chaski.send({
      type: TYPES[i % TYPES.length] ?? 'welcome',
      // Every fifth contact has no email, so some email deliveries skip.
      recipient:
        i % 5 === 4 ? { id, name } : { id, name, email: `${name.toLowerCase()}@example.com` },
      payload: { amount: 100 + i * 25, invoice: `INV-${1000 + i}`, due: 'Feb 20' },
    });
    sent++;
  }
  for (let i = 0; i < 6; i++) {
    await chaski.schedule({
      type: 'invoice_due',
      recipient: { id: `user_${String(1000 + i)}`, email: 'ana@example.com' },
      payload: { invoice: `INV-${2000 + i}`, due: 'Mar 1' },
      scheduledAt: new Date(Date.now() + (i + 1) * 6 * 3_600_000).toISOString(),
      groupKey: i < 3 ? 'reminders' : undefined,
    });
  }
  return { sent, scheduled: 6 };
};
