import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateFile } from '../src';
import type { SendRequest } from '../src/contract/contract';
import { api as chaski } from '../src/server/api';
import { getClient } from '../src/server/db';
import { ScheduleService } from '../src/server/services/schedule.service';
import { TemplateService } from '../src/server/services/template.service';
import {
  api,
  processDeliveries,
  recipient,
  type SentEmail,
  saveLocales,
  stubEmail,
} from './helpers';

// Email has Spanish, in-app doesn't: a Spanish contact gets one of each.
const FILE: TemplateFile = {
  format: 'chaski.templates',
  version: 2,
  defaultLocale: 'en',
  templates: [
    {
      type: 'payment_received',
      sampleData: '{"amount": 1500}',
      channels: [
        {
          channel: 'email',
          enabled: true,
          subject: 'We received {{ amount }}',
          body: '<p>Thanks</p>',
          translations: {
            es: { subject: 'Recibimos {{ amount }}', body: '<p>Gracias</p>' },
            'pt-BR': { subject: 'Recebemos {{ amount }}', body: '<p>Obrigado</p>' },
          },
        },
        { channel: 'in_app', enabled: true, subject: 'Payment received', body: '{{ amount }}' },
      ],
    },
  ],
};

let sent: SentEmail[] = [];

const send = async (request: Partial<SendRequest> = {}) => {
  const result = await chaski.send({
    type: 'payment_received',
    recipient: recipient(),
    payload: { amount: 1500 },
    ...request,
  });
  await processDeliveries(result.notificationId);
  return result;
};

const deliveryOf = async (notificationId: string, channel: string) =>
  getClient().deliveries.findFirst({ where: { notificationId, channel } });

const notification = (id: string) => getClient().notifications.findFirst({ where: { id } });

const templateId = async () => (await TemplateService.getByType('payment_received')).template.id;

const json = async (path: string, init: RequestInit = {}) => {
  const response = await api(path, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

beforeEach(async () => {
  sent = stubEmail();
  await saveLocales('en', ['es', 'pt-BR']);
  await chaski.templates.import(FILE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the language a send goes out in', () => {
  it('picks each channel’s closest content on its own, and records it', async () => {
    const { notificationId } = await send({ recipient: { ...recipient(), locale: 'es-PE' } });

    expect(sent[0]?.subject).toBe('Recibimos 1500');
    const [item] = await getClient().feedItems.findMany({ where: { notificationId } });
    expect(item).toMatchObject({ title: 'Payment received' });
    expect(await notification(notificationId)).toMatchObject({
      requestedLocale: 'es-PE',
      requestedLocaleFrom: 'contact',
    });
    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ renderedLocale: 'es' });
    expect(await deliveryOf(notificationId, 'in_app')).toMatchObject({ renderedLocale: 'en' });
  });

  it('takes the exact locale before its language', async () => {
    await send({ recipient: { ...recipient(), locale: 'pt-BR' } });
    await send({ recipient: { ...recipient('user_2'), locale: 'pt' } });

    // pt-BR has its own content; plain pt doesn't, and nothing falls to a region.
    expect(sent.map((email) => email.subject)).toEqual(['Recebemos 1500', 'We received 1500']);
  });

  it('takes the send’s locale over the contact’s, without saving it to the contact', async () => {
    const { notificationId } = await send({
      recipient: { ...recipient(), locale: 'en' },
      locale: 'es',
    });

    expect(sent[0]?.subject).toBe('Recibimos 1500');
    expect(await notification(notificationId)).toMatchObject({
      requestedLocale: 'es',
      requestedLocaleFrom: 'send',
    });
    expect(
      await getClient().contacts.findFirst({ where: { recipientId: 'user_1' } }),
    ).toMatchObject({ locale: 'en' });
  });

  it('reads a locale Intl can’t read as absent, and one written loosely as its canonical form', async () => {
    const broken = await send({
      recipient: { ...recipient(), locale: 'en' },
      locale: 'not a locale!',
    });
    const loose = await send({ recipient: { ...recipient('user_2'), locale: 'ES_pe' } });
    const unreadable = await send({ recipient: { ...recipient('user_3'), locale: '??' } });

    expect(sent.map((email) => email.subject)).toEqual([
      'We received 1500',
      'Recibimos 1500',
      'We received 1500',
    ]);
    expect(await notification(broken.notificationId)).toMatchObject({
      requestedLocale: 'en',
      requestedLocaleFrom: 'contact',
    });
    expect(await notification(loose.notificationId)).toMatchObject({ requestedLocale: 'es-PE' });
    expect(await notification(unreadable.notificationId)).toMatchObject({
      requestedLocale: null,
      requestedLocaleFrom: null,
    });
  });

  it('keeps a language taken off the Worker, unused until it comes back', async () => {
    await saveLocales('en', ['pt-BR']);
    await send({ locale: 'es' });

    const { body } = await json(`/templates/${await templateId()}`);
    const email = (body.channels as Array<{ channel: string; translations: unknown[] }>)[0];
    expect(email?.translations).toEqual([
      expect.objectContaining({ locale: 'es', supported: false }),
      expect.objectContaining({ locale: 'pt-BR', supported: true }),
    ]);

    await saveLocales('en', ['es', 'pt-BR']);
    await send({ locale: 'es' });
    expect(sent.map((email) => email.subject)).toEqual(['We received 1500', 'Recibimos 1500']);
  });

  it('formats in the language rendered and the contact’s timezone, and exposes it as locale', async () => {
    const { template } = await TemplateService.getByType('payment_received');
    await TemplateService.upsertChannel(template.id, 'email', {
      subject: "{{ amount | currency: 'USD' }} · {{ paidAt | format_date }} · {{ locale }}",
    });
    await TemplateService.saveTranslation(template.id, 'email', 'es', {
      subject: "{{ amount | currency: 'USD' }} · {{ paidAt | format_date }} · {{ locale }}",
    });
    const payload = { amount: 1500, paidAt: '2026-10-30T03:30:00Z', locale: 'payload' };

    await send({ payload, recipient: { ...recipient(), timezone: 'America/Lima' } });
    await send({ payload, recipient: recipient('user_2'), locale: 'es-PE' });

    expect(sent.map((email) => email.subject.replace(/ /g, ' '))).toEqual([
      '$1,500.00 · October 29, 2026 · en',
      '1500,00 US$ · 30 de octubre de 2026 · es',
    ]);
  });

  it('fails a delivery for good when a filter’s argument is wrong', async () => {
    await TemplateService.upsertChannel(await templateId(), 'email', {
      subject: '{{ amount | currency }}',
    });

    const { notificationId } = await send();

    expect(await deliveryOf(notificationId, 'email')).toMatchObject({
      status: 'failed',
      errorCode: 'validation',
      lastError: expect.stringContaining('ISO 4217'),
      renderedLocale: 'en',
    });
  });

  it('renders the default content, recording no language, while the Worker has none', async () => {
    await getClient().settings.deleteMany({ where: { section: 'locales' } });
    await chaski.ready();
    const { template } = await TemplateService.getByType('payment_received');
    await TemplateService.upsertChannel(template.id, 'email', { subject: 'Hi {{ locale }}' });

    const { notificationId } = await send({ locale: 'es', payload: { locale: 'from the app' } });

    expect(sent[0]?.subject).toBe('Hi from the app');
    expect(await notification(notificationId)).toMatchObject({ requestedLocale: 'es' });
    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ renderedLocale: null });
  });

  it('carries a scheduled send’s language to when it fires', async () => {
    const { scheduledId } = await chaski.schedule({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 1500 },
      channels: ['email'],
      locale: 'es',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    await ScheduleService.fire(scheduledId);
    const fired = await getClient().notifications.findFirst({
      where: { idempotencyKey: `sched_${scheduledId}` },
    });
    await processDeliveries(fired?.id ?? '');

    expect(fired).toMatchObject({ requestedLocale: 'es', requestedLocaleFrom: 'send' });
    expect(sent[0]?.subject).toBe('Recibimos 1500');
  });
});

describe('the Worker’s languages', () => {
  it('reads and saves them, the default out of the others', async () => {
    const saved = await json('/settings/locales', {
      method: 'PUT',
      body: JSON.stringify({ default: 'en', supported: ['es', 'EN', 'pt_br', 'es'] }),
    });

    expect(saved).toEqual({
      status: 200,
      body: {
        locales: {
          default: 'en',
          supported: ['es', 'pt-BR'],
          translations: 2,
          updatedBy: { id: 'admin@chaski.test', name: 'admin@chaski.test' },
          updatedAt: expect.any(String),
          problem: null,
        },
      },
    });
    expect((await json('/settings/locales')).body).toEqual(saved.body);
  });

  it('changes the default only while no template has translations', async () => {
    const change = await json('/settings/locales', {
      method: 'PUT',
      body: JSON.stringify({ default: 'es', supported: ['en'] }),
    });
    expect(change).toMatchObject({
      status: 409,
      body: {
        error: 'conflict',
        message: expect.stringContaining("the default language stays 'en'"),
      },
    });

    await TemplateService.deleteLanguage(await templateId(), 'es');
    await TemplateService.deleteLanguage(await templateId(), 'pt-BR');
    const free = await json('/settings/locales', {
      method: 'PUT',
      body: JSON.stringify({ default: 'es', supported: ['en'] }),
    });
    expect(free.body).toMatchObject({ locales: { default: 'es', supported: ['en'] } });
  });

  it('refuses a tag that isn’t a language', async () => {
    const response = await json('/settings/locales', {
      method: 'PUT',
      body: JSON.stringify({ default: 'en', supported: ['not a tag!'] }),
    });

    expect(response).toMatchObject({
      status: 400,
      body: { error: 'validation', message: expect.stringContaining('supported.0') },
    });
  });
});

describe('translations in the admin API', () => {
  const path = async (locale = 'es', channel = 'email') =>
    `/templates/${await templateId()}/channels/${channel}/translations/${locale}`;

  it('saves, reads and deletes a translation', async () => {
    const saved = await json(await path('es', 'in_app'), {
      method: 'PUT',
      body: JSON.stringify({ subject: 'Pago recibido', body: '{{ amount }}' }),
    });
    expect(saved).toEqual({
      status: 200,
      body: {
        translation: {
          channel: 'in_app',
          locale: 'es',
          subject: 'Pago recibido',
          body: '{{ amount }}',
          textBody: null,
          status: 'complete',
          supported: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      },
    });

    // Omitted keeps a field, null clears it.
    const edited = await json(await path('es', 'in_app'), {
      method: 'PUT',
      body: JSON.stringify({ subject: null, textBody: '/pagos' }),
    });
    expect(edited.body).toMatchObject({
      translation: { subject: null, body: '{{ amount }}', textBody: '/pagos' },
    });
    expect((await json(await path('es', 'in_app'))).body).toEqual(edited.body);

    expect(await json(await path('es', 'in_app'), { method: 'DELETE' })).toEqual({
      status: 200,
      body: { id: 'es', channel: 'in_app', deleted: true },
    });
    expect((await json(await path('es', 'in_app'))).status).toBe(404);
  });

  it('removes a language from every channel of a template at once', async () => {
    await json(await path('es', 'in_app'), {
      method: 'PUT',
      body: JSON.stringify({ body: 'Pago' }),
    });

    const removed = await json(`/templates/${await templateId()}/translations/es`, {
      method: 'DELETE',
    });

    expect(removed.body).toEqual({ id: 'es', channels: 2, deleted: true });
    expect((await json(await path('es'))).status).toBe(404);
  });

  it('refuses what a translation can’t be', async () => {
    const put = async (locale: string, body: unknown, channel = 'email') =>
      json(await path(locale, channel), { method: 'PUT', body: JSON.stringify(body) });

    expect(await put('fr', { body: 'Merci' })).toMatchObject({
      status: 400,
      body: { message: expect.stringContaining("fr isn't one of this Chaski's languages") },
    });
    expect(await put('en', { body: 'Thanks' })).toMatchObject({
      status: 400,
      body: { message: expect.stringContaining('en is the default language') },
    });
    expect(await put('es', { body: '  ' }, 'in_app')).toMatchObject({
      status: 400,
      body: { message: 'body: a translation needs a body' },
    });
    expect(await put('es', { body: '{{ a | }' })).toMatchObject({
      status: 400,
      body: { message: expect.stringMatching(/^body: /) },
    });
    expect((await put('not a tag!', { body: 'x' })).status).toBe(400);
    expect((await put('es', { body: 'x' }, 'push')).status).toBe(404);
  });

  it('reads a translation as outdated once its default content changes', async () => {
    const id = await templateId();
    const status = async () =>
      ((await json(await path())).body.translation as { status: string }).status;
    expect(await status()).toBe('complete');

    await api(`/templates/${id}/channels/email`, {
      method: 'PUT',
      body: JSON.stringify({ subject: 'We got {{ amount }}' }),
    });
    expect(await status()).toBe('outdated');
    const list = await json('/templates');
    expect(list.body.templates).toEqual([
      expect.objectContaining({
        channels: [
          {
            channel: 'email',
            enabled: true,
            translations: { es: 'outdated', 'pt-BR': 'outdated' },
          },
          { channel: 'in_app', enabled: true, translations: { es: 'missing', 'pt-BR': 'missing' } },
        ],
      }),
    ]);

    const marked = await json(`${await path()}/mark-current`, { method: 'POST' });
    expect(marked.body).toMatchObject({
      translation: { status: 'complete', subject: 'Recibimos {{ amount }}' },
    });

    await api(`/templates/${id}/channels/email`, {
      method: 'PUT',
      body: JSON.stringify({ subject: 'Paid: {{ amount }}' }),
    });
    expect(await status()).toBe('outdated');
    await json(await path(), { method: 'PUT', body: JSON.stringify({ subject: 'Pagado' }) });
    expect(await status()).toBe('complete');
  });

  it('previews and test-sends what a contact asking for a language gets', async () => {
    const id = await templateId();
    const preview = async (body: Record<string, unknown>) =>
      (
        await json(`/templates/${id}/preview`, {
          method: 'POST',
          body: JSON.stringify({ data: { amount: 1500 }, ...body }),
        })
      ).body;

    expect(await preview({ channel: 'email', locale: 'es-PE' })).toEqual({
      subject: 'Recibimos 1500',
      html: '<p>Gracias</p>',
      locale: 'es',
    });
    expect(await preview({ channel: 'in_app', locale: 'es' })).toMatchObject({
      subject: 'Payment received',
      locale: 'en',
    });
    expect(
      await preview({
        channel: 'email',
        locale: 'es',
        content: { subject: '{{ amount | number: 2 }} {{ locale }}', body: 'x' },
      }),
    ).toMatchObject({ subject: '1500,00 es', locale: 'es' });

    const test = await json(`/templates/${id}/test-send`, {
      method: 'POST',
      body: JSON.stringify({ to: 'ana@example.com', locale: 'pt-BR' }),
    });
    expect(test.body).toEqual({ messageId: 'msg_1', locale: 'pt-BR' });
    expect(sent[0]?.subject).toBe('[test] Recebemos 1500');
  });

  it('shows the language asked for and the one sent on each delivery', async () => {
    const { notificationId } = await send({ locale: 'es' });

    const { body } = await json(`/deliveries?type=payment_received`);
    const rows = body.deliveries as Array<Record<string, unknown>>;
    expect(rows.map((row) => [row.channel, row.requestedLocale, row.renderedLocale])).toEqual(
      expect.arrayContaining([
        ['email', 'es', 'es'],
        ['in_app', 'es', 'en'],
      ]),
    );
    const email = await deliveryOf(notificationId, 'email');
    expect((await json(`/deliveries/${email?.id}`)).body.delivery).toMatchObject({
      requestedLocale: 'es',
      requestedLocaleFrom: 'send',
      renderedLocale: 'es',
    });
  });

  it('counts the deliveries that went out in another language than asked for', async () => {
    await send({ locale: 'es' });
    await send({ locale: 'es-MX' });
    await send({ locale: 'en-GB' });
    await send({ locale: 'pt-BR' });

    const { body } = await json('/metrics/overview?period=7d');

    // The email had es and pt-BR, and en-GB is English: only in-app fell back, for both.
    expect(body.languageFallbacks).toEqual({
      total: 3,
      rows: [
        { type: 'payment_received', channel: 'in_app', requestedLocale: 'es', count: 1 },
        { type: 'payment_received', channel: 'in_app', requestedLocale: 'es-MX', count: 1 },
        { type: 'payment_received', channel: 'in_app', requestedLocale: 'pt-BR', count: 1 },
      ],
    });
  });
});

describe('translations in the template file', () => {
  it('exports them in a version 2 file that imports back unchanged', async () => {
    const id = await templateId();
    await TemplateService.upsertChannel(id, 'email', { subject: 'Changed' });
    await TemplateService.markTranslationCurrent(id, 'email', 'pt-BR');
    const exported = await chaski.templates.export();

    expect(exported).toMatchObject({ version: 2, defaultLocale: 'en' });
    expect(exported.templates[0]?.channels?.[0]?.translations).toEqual({
      es: {
        subject: 'Recibimos {{ amount }}',
        body: '<p>Gracias</p>',
        textBody: null,
        outdated: true,
      },
      'pt-BR': { subject: 'Recebemos {{ amount }}', body: '<p>Obrigado</p>', textBody: null },
    });

    await getClient().templates.delete({ where: { id }, mode: 'hard' });
    expect(await chaski.templates.import(exported)).toMatchObject({
      changes: [{ type: 'payment_received', change: 'create' }],
    });
    expect(await chaski.templates.export()).toEqual(exported);
    expect((await chaski.templates.import(exported)).changes).toEqual([
      { type: 'payment_received', change: 'unchanged', fields: [], warnings: [] },
    ]);
  });

  it('previews which translations an import adds or changes', async () => {
    const [payment] = FILE.templates;
    const [email, inApp] = payment?.channels ?? [];
    const preview = await chaski.templates.import(
      {
        ...FILE,
        templates: [
          {
            ...payment,
            type: 'payment_received',
            channels: [
              {
                ...(email as NonNullable<typeof email>),
                translations: {
                  es: { subject: 'Recibido {{ amount }}', body: '<p>Gracias</p>' },
                  'pt-BR': {
                    subject: 'Recebemos {{ amount }}',
                    body: '<p>Obrigado</p>',
                    outdated: true,
                  },
                },
              },
              { ...(inApp as NonNullable<typeof inApp>), translations: { es: { body: 'Pago' } } },
            ],
          },
        ],
      },
      { preview: true },
    );

    expect(preview.changes[0]?.fields).toEqual([
      'channels.email.translations.es.subject',
      'channels.email.translations.pt-BR.outdated',
      'channels.in_app.translations.es',
    ]);
  });

  it('still imports a version 1 file, and refuses one that carries translations', async () => {
    const v1 = {
      format: 'chaski.templates',
      version: 1,
      templates: [{ type: 'welcome', channels: [{ channel: 'email', enabled: true, body: 'Hi' }] }],
    };
    expect(await chaski.templates.import(v1)).toMatchObject({ applied: true });

    await expect(
      chaski.templates.import({
        ...v1,
        templates: [
          {
            type: 'welcome',
            channels: [
              {
                channel: 'email',
                enabled: true,
                body: 'Hi',
                translations: { es: { body: 'Hola' } },
              },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'templates.0.channels.0.translations: translations need a file of version 2',
    });
    await expect(chaski.templates.import({ ...v1, defaultLocale: 'en' })).rejects.toMatchObject({
      message: 'defaultLocale: translations need a file of version 2',
    });
  });

  it('refuses a file whose default language isn’t the Worker’s, or that translates into it', async () => {
    await expect(chaski.templates.import({ ...FILE, defaultLocale: 'fr' })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining("this Chaski's default language is en"),
    });

    const intoDefault = structuredClone(FILE);
    const channel = intoDefault.templates[0]?.channels?.[0];
    if (channel) channel.translations = { EN: { body: 'Thanks' } };
    await expect(chaski.templates.import(intoDefault)).rejects.toMatchObject({
      message: expect.stringContaining('en is the default language'),
    });

    const withoutDefault = { ...FILE, defaultLocale: undefined };
    await expect(chaski.templates.import(withoutDefault)).rejects.toMatchObject({
      message: expect.stringContaining('a file with translations names its defaultLocale'),
    });
  });
});
