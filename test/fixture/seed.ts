import type { TemplateFile } from '../../src';
import type { ChaskiApi } from '../../src/contract/api';

// Sample data for `pnpm dev`, so the dashboard has something to show. It goes
// in through the API ChaskiEntrypoint serves an app: templates, sends and
// schedules.

// Spanish everywhere but payment_received's in-app item, and Portuguese only on its email, so the
// dashboard has every language status to show.
const TEMPLATES: TemplateFile = {
  format: 'chaski.templates',
  version: 2,
  defaultLocale: 'en',
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
          translations: {
            es: {
              subject: "Recibimos {{ amount | currency: 'USD' }}",
              body: '<h1 style="font-family:sans-serif">Gracias, {{ recipient.name }}</h1><p style="font-family:sans-serif">Recibimos tu pago de <strong>{{ amount | currency: \'USD\' }}</strong>.</p>',
              textBody: "Recibimos tu pago de {{ amount | currency: 'USD' }}.",
            },
            'pt-BR': {
              subject: "Recebemos {{ amount | currency: 'USD' }}",
              body: '<p style="font-family:sans-serif">Recebemos seu pagamento de <strong>{{ amount | currency: \'USD\' }}</strong>.</p>',
            },
          },
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
          translations: {
            es: {
              subject: 'La factura {{ invoice }} vence el {{ due }}',
              body: '<p style="font-family:sans-serif">La factura {{ invoice }} vence el {{ due }}.</p>',
            },
          },
        },
        {
          channel: 'push',
          enabled: true,
          subject: 'Invoice due',
          body: '{{ invoice }} is due {{ due }}',
          textBody: '/invoices',
          translations: {
            es: {
              subject: 'Factura por vencer',
              body: '{{ invoice }} vence el {{ due }}',
              textBody: '/invoices',
            },
          },
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
          translations: {
            es: {
              subject: 'Te damos la bienvenida, {{ recipient.name }}',
              body: '<p style="font-family:sans-serif">Tu cuenta está lista.</p>',
            },
          },
        },
        {
          channel: 'in_app',
          enabled: true,
          subject: 'Welcome',
          body: 'Your account is ready.',
          translations: {
            es: { subject: 'Te damos la bienvenida', body: 'Tu cuenta está lista.' },
          },
        },
      ],
    },
  ],
};

const NAMES = ['Ana', 'Luis', 'Marta', 'Jo', 'Sam', 'Noor', 'Kim', 'Leo'];
// Contacts in English, Spanish (some from Peru), Brazilian Portuguese and French, which the
// Worker doesn't have: every language a send can resolve to, and the fallbacks.
const LOCALES = ['en', 'es-PE', 'es', 'pt-BR', 'fr', 'en-GB', 'es-MX', 'en'];
const TYPES = ['payment_received', 'invoice_due', 'welcome'] as const;

export const seed = async (chaski: ChaskiApi) => {
  await chaski.templates.import(TEMPLATES);
  let sent = 0;
  for (let i = 0; i < 40; i++) {
    const name = NAMES[i % NAMES.length] ?? 'Ana';
    const id = `user_${String(1000 + i)}`;
    await chaski.send({
      type: TYPES[i % TYPES.length] ?? 'welcome',
      // Every fifth contact has no email, so some email deliveries skip.
      recipient: {
        ...(i % 5 === 4 ? { id, name } : { id, name, email: `${name.toLowerCase()}@example.com` }),
        locale: LOCALES[i % LOCALES.length],
      },
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
