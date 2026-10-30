import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '../src';
import { templatesToSql } from '../src/cli/templates-sql';
import { api as chaski } from '../src/server/api';
import { TemplateService } from '../src/server/services/template.service';
import { saveLocales } from './helpers';

const BASE: TemplateFile = {
  format: 'chaski.templates',
  version: 2,
  defaultLocale: 'en',
  templates: [
    {
      type: 'payment_received',
      description: 'A payment cleared',
      topic: 'billing',
      channels: [
        {
          channel: 'email',
          enabled: true,
          subject: 'Paid',
          body: '<p>{{ amount }}</p>',
          translations: { es: { subject: 'Pagado', body: '<p>{{ amount }}</p>' } },
        },
        {
          channel: 'in_app',
          enabled: true,
          subject: 'Paid',
          body: '{{ amount }}',
          translations: { es: { subject: 'Pagado', body: '{{ amount }}' } },
        },
      ],
    },
    {
      type: 'welcome',
      channels: [
        {
          channel: 'email',
          enabled: true,
          subject: 'Hi',
          body: 'Hi',
          translations: { es: { subject: 'Hola', body: 'Hola' } },
        },
      ],
    },
    {
      type: 'legacy',
      channels: [{ channel: 'email', enabled: true, subject: 'Old', body: 'Old' }],
    },
  ],
};

// Changes a field, clears one the file leaves out, edits a channel and its translation, adds a
// translation, takes an outdated one as current, keeps one template as it is, brings back a
// deleted type and adds a new one. Quotes and newlines must survive the SQL.
const NEXT: TemplateFile = {
  format: 'chaski.templates',
  version: 2,
  defaultLocale: 'en',
  templates: [
    {
      type: 'payment_received',
      topic: 'payments',
      channels: [
        {
          channel: 'email',
          enabled: true,
          subject: "It's paid",
          body: '<p>{{ amount }}</p>\n<p>Thanks</p>',
          translations: {
            es: { subject: 'Está pagado', body: '<p>{{ amount }}</p>\n<p>Gracias</p>' },
            'pt-br': { subject: "Pago d'água", body: '<p>{{ amount }}</p>', outdated: true },
          },
        },
        {
          channel: 'in_app',
          enabled: true,
          subject: 'Paid',
          body: '{{ amount }} received',
          translations: { es: { subject: 'Pagado', body: '{{ amount }}' } },
        },
      ],
    },
    BASE.templates[1] as TemplateFile['templates'][number],
    {
      type: 'legacy',
      channels: [
        {
          channel: 'in_app',
          enabled: false,
          subject: 'Back',
          body: 'Back',
          translations: { es: { body: 'Vuelve' } },
        },
      ],
    },
    { type: 'invoice_due', sampleData: '{"invoice":"INV-1"}', channels: [] },
  ],
};

// The same starting point for each run: a channel the next file leaves out (push), a translation
// left outdated by an edit of its channel, and a deleted template whose type the next file brings
// back.
const prepare = async () => {
  await env.CHASKI_DB.prepare('DELETE FROM template_translations').run();
  await env.CHASKI_DB.prepare('DELETE FROM template_channels').run();
  await env.CHASKI_DB.prepare('DELETE FROM templates').run();
  await chaski.templates.import(BASE);
  const { template: payment } = await TemplateService.getByType('payment_received');
  await TemplateService.upsertChannel(payment.id, 'push', {
    enabled: true,
    subject: 'P',
    body: 'P',
  });
  await TemplateService.upsertChannel(payment.id, 'in_app', { body: '{{ amount }} received' });
  await TemplateService.deleteTemplate((await TemplateService.getByType('legacy')).template.id);
};

const runSql = async (file: unknown) => {
  const db = env.CHASKI_DB;
  const { statements } = await templatesToSql(file);
  await db.batch(statements.map((statement) => db.prepare(statement)));
};

const rows = async () => ({
  templates: (
    await env.CHASKI_DB.prepare(
      'SELECT id, type, deleted_at IS NOT NULL AS deleted, updated_at FROM templates ORDER BY type, deleted',
    ).all<{ id: string; type: string; deleted: number; updated_at: number }>()
  ).results,
  channels: (
    await env.CHASKI_DB.prepare(
      'SELECT c.id, t.type, c.channel, c.updated_at FROM template_channels c JOIN templates t ON t.id = c.template_id ORDER BY t.type, c.channel, t.deleted_at',
    ).all<{ id: string; type: string; channel: string; updated_at: number }>()
  ).results,
  translations: (
    await env.CHASKI_DB.prepare(
      'SELECT t.type, c.channel, l.locale, l.source_hash, l.updated_at FROM template_translations l JOIN template_channels c ON c.id = l.template_channel_id JOIN templates t ON t.id = c.template_id ORDER BY t.type, c.channel, l.locale, t.deleted_at',
    ).all<{ type: string; channel: string; locale: string; source_hash: string }>()
  ).results,
});

// What the database holds, apart from the ids and instants of rows each run created on its own.
const snapshot = async (before: Awaited<ReturnType<typeof rows>>) => {
  const after = await rows();
  const kept = (id: unknown) => [...before.templates, ...before.channels].some((r) => r.id === id);
  return {
    file: await TemplateService.exportFile(),
    deleted: (await TemplateService.listDeleted()).map((t) => t.type),
    templates: after.templates.map((r) => ({
      ...r,
      id: kept(r.id) ? r.id : 'new',
      updated_at: undefined,
    })),
    channels: after.channels.map((r) => ({
      ...r,
      id: kept(r.id) ? r.id : 'new',
      updated_at: undefined,
    })),
    translations: after.translations.map((r) => ({ ...r, updated_at: undefined })),
  };
};

describe('templates as SQL', () => {
  it('leaves the database as templates.import() does', async () => {
    await saveLocales('en', ['es', 'pt-BR']);
    await prepare();
    const start = await rows();
    await chaski.templates.import(NEXT);
    const imported = await snapshot(start);

    await prepare();
    const again = await rows();
    await runSql(NEXT);
    const applied = await snapshot(again);

    // Each prepare() makes rows of its own, so ids compare within each run.
    const ids = (s: typeof imported, base: typeof start) =>
      s.templates.map((r) =>
        r.id === 'new' ? 'new' : base.templates.findIndex((b) => b.id === r.id),
      );
    expect(applied.file).toEqual(imported.file);
    expect(applied.deleted).toEqual(imported.deleted);
    expect(ids(applied, again)).toEqual(ids(imported, start));
    expect(applied.channels.map((c) => [c.type, c.channel, c.id === 'new'])).toEqual(
      imported.channels.map((c) => [c.type, c.channel, c.id === 'new']),
    );
    expect(applied.translations).toEqual(imported.translations);
    const payment = applied.file.templates.find((t) => t.type === 'payment_received');
    expect(payment).toMatchObject({
      description: null,
      topic: 'payments',
      channels: [
        expect.objectContaining({ channel: 'email', subject: "It's paid" }),
        expect.objectContaining({ channel: 'in_app' }),
        expect.objectContaining({ channel: 'push', subject: 'P' }),
      ],
    });
    expect(payment?.channels?.[0]?.translations).toEqual({
      es: { subject: 'Está pagado', body: '<p>{{ amount }}</p>\n<p>Gracias</p>', textBody: null },
      'pt-BR': {
        subject: "Pago d'água",
        body: '<p>{{ amount }}</p>',
        textBody: null,
        outdated: true,
      },
    });
    // Saved again from the content its channel holds now, so no longer outdated.
    expect(payment?.channels?.[1]?.translations?.es).not.toHaveProperty('outdated');
  });

  it('changes nothing the second time, and touches no row that already matches', async () => {
    await saveLocales('en', ['es', 'pt-BR']);
    await prepare();
    const welcome = await rows();
    await runSql(NEXT);
    const first = await rows();

    await runSql(NEXT);

    expect(await rows()).toEqual(first);
    expect(first.templates.find((r) => r.type === 'welcome')).toEqual(
      welcome.templates.find((r) => r.type === 'welcome'),
    );
    expect(first.translations.find((r) => r.type === 'welcome')).toEqual(
      welcome.translations.find((r) => r.type === 'welcome'),
    );
  });

  it('passes on the import warnings without changing the content', async () => {
    const { statements, warnings } = await templatesToSql({
      ...NEXT,
      templates: [
        {
          type: 'x',
          channels: [
            {
              channel: 'push',
              enabled: true,
              subject: 'A &middot; B',
              body: 'b',
              translations: { es: { subject: 'A &amp; B', body: 'b' } },
            },
          ],
        },
      ],
    });

    expect(warnings).toEqual([
      'x: channels.push.subject is plain text and shows &middot; as typed',
      'x: channels.push.translations.es.subject is plain text and shows &amp; as typed',
    ]);
    expect(statements.join('\n')).toContain("'A &middot; B'");
  });

  it('refuses the files and the Liquid templates.import() refuses', async () => {
    await expect(templatesToSql({ ...NEXT, version: 3 })).rejects.toThrowError(/^version: /);
    await expect(
      templatesToSql({
        ...NEXT,
        templates: [
          { type: 'x', channels: [{ channel: 'email', enabled: true, body: '{{ a | }' }] },
        ],
      }),
    ).rejects.toThrowError(/^x email body: /);
    await expect(
      templatesToSql({
        ...NEXT,
        templates: [
          {
            type: 'x',
            channels: [
              {
                channel: 'email',
                enabled: true,
                body: 'b',
                translations: { es: { body: '{{ a | }' } },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrowError(/^x email es body: /);
  });

  // The file can't know the database, so the database refuses it where the import would.
  it('fails in the database whose default language is not the file’s, as the import does', async () => {
    await saveLocales('es', []);

    await expect(chaski.templates.import(NEXT)).rejects.toMatchObject({ code: 'validation' });
    await expect(runSql(NEXT)).rejects.toThrowError(
      /this file has its default content in en, so it loads only into a Chaski whose default language is en/,
    );
    expect((await rows()).templates).toEqual([]);
  });

  it('fails while the database has no languages and the file has translations', async () => {
    await expect(chaski.templates.import(BASE)).rejects.toMatchObject({ code: 'validation' });
    await expect(runSql(BASE)).rejects.toThrowError(/this file has its default content in en/);

    const untranslated: TemplateFile = {
      ...BASE,
      templates: BASE.templates.filter((t) => t.type === 'legacy'),
    };
    await chaski.templates.import(untranslated);
    await env.CHASKI_DB.prepare('DELETE FROM template_channels').run();
    await env.CHASKI_DB.prepare('DELETE FROM templates').run();
    await runSql(untranslated);
    expect((await rows()).templates.map((r) => r.type)).toEqual(['legacy']);
  });
});
