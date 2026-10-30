import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '../src';
import { templatesToSql } from '../src/cli/templates-sql';
import { api as chaski } from '../src/server/api';
import { TemplateService } from '../src/server/services/template.service';

const BASE: TemplateFile = {
  format: 'chaski.templates',
  version: 1,
  templates: [
    {
      type: 'payment_received',
      description: 'A payment cleared',
      topic: 'billing',
      channels: [
        { channel: 'email', enabled: true, subject: 'Paid', body: '<p>{{ amount }}</p>' },
        { channel: 'in_app', enabled: true, subject: 'Paid', body: '{{ amount }}' },
      ],
    },
    { type: 'welcome', channels: [{ channel: 'email', enabled: true, subject: 'Hi', body: 'Hi' }] },
    {
      type: 'legacy',
      channels: [{ channel: 'email', enabled: true, subject: 'Old', body: 'Old' }],
    },
  ],
};

// Changes a field, clears one the file leaves out, edits a channel, keeps one template as it is,
// brings back a deleted type and adds a new one. Quotes and newlines must survive the SQL.
const NEXT: TemplateFile = {
  format: 'chaski.templates',
  version: 1,
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
        },
        { channel: 'in_app', enabled: true, subject: 'Paid', body: '{{ amount }}' },
      ],
    },
    BASE.templates[1] as TemplateFile['templates'][number],
    {
      type: 'legacy',
      channels: [{ channel: 'in_app', enabled: false, subject: 'Back', body: 'Back' }],
    },
    { type: 'invoice_due', sampleData: '{"invoice":"INV-1"}', channels: [] },
  ],
};

// The same starting point for each run: a channel the next file leaves out (push), and a deleted
// template whose type the next file brings back.
const prepare = async () => {
  await env.CHASKI_DB.prepare('DELETE FROM template_channels').run();
  await env.CHASKI_DB.prepare('DELETE FROM templates').run();
  await chaski.templates.import(BASE);
  const { template: payment } = await TemplateService.getByType('payment_received');
  await TemplateService.upsertChannel(payment.id, 'push', {
    enabled: true,
    subject: 'P',
    body: 'P',
  });
  await TemplateService.deleteTemplate((await TemplateService.getByType('legacy')).template.id);
};

const runSql = async (file: unknown) => {
  const db = env.CHASKI_DB;
  await db.batch(templatesToSql(file).statements.map((statement) => db.prepare(statement)));
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
  };
};

describe('templates as SQL', () => {
  it('leaves the database as templates.import() does', async () => {
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
    expect(applied.file.templates.find((t) => t.type === 'payment_received')).toMatchObject({
      description: null,
      topic: 'payments',
      channels: [
        expect.objectContaining({ channel: 'email', subject: "It's paid" }),
        expect.objectContaining({ channel: 'in_app' }),
        expect.objectContaining({ channel: 'push', subject: 'P' }),
      ],
    });
  });

  it('changes nothing the second time, and touches no row that already matches', async () => {
    await prepare();
    const welcome = (await rows()).templates.find((r) => r.type === 'welcome');
    await runSql(NEXT);
    const first = await rows();

    await runSql(NEXT);

    expect(await rows()).toEqual(first);
    expect(first.templates.find((r) => r.type === 'welcome')).toEqual(welcome);
  });

  it('passes on the import warnings without changing the content', () => {
    const { statements, warnings } = templatesToSql({
      ...NEXT,
      templates: [
        {
          type: 'x',
          channels: [{ channel: 'push', enabled: true, subject: 'A &middot; B', body: 'b' }],
        },
      ],
    });

    expect(warnings).toEqual([
      'x: channels.push.subject is plain text and shows &middot; as typed',
    ]);
    expect(statements.join('\n')).toContain("'A &middot; B'");
  });

  it('refuses the files and the Liquid templates.import() refuses', () => {
    expect(() => templatesToSql({ ...NEXT, version: 2 })).toThrowError(/^version: /);
    expect(() =>
      templatesToSql({
        ...NEXT,
        templates: [
          { type: 'x', channels: [{ channel: 'email', enabled: true, body: '{{ a | }' }] },
        ],
      }),
    ).toThrowError(/^x email body: /);
  });
});
