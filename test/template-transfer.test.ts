import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '../src';
import { getClient } from '../src/server/db';
import { chaski } from './fixture/worker';
import { api, recipient } from './helpers';

const exported = async () => {
  const response = await api('/templates/export');
  return { response, data: (await response.json()) as TemplateFile };
};

const importTemplates = async (data: unknown, query = '') => {
  const response = await api(`/templates/import${query}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const updatedAt = async (type: string) =>
  (await getClient().templates.findFirst({ where: { type } }))?.updatedAt.getTime();

const wipeTemplates = async () => {
  await env.CHASKI_DB.prepare('DELETE FROM template_channels').run();
  await env.CHASKI_DB.prepare('DELETE FROM templates').run();
};

const FILE: TemplateFile = {
  format: 'chaski.templates',
  version: 1,
  templates: [
    {
      type: 'payment_received',
      description: 'A payment cleared',
      topic: 'billing',
      sampleData: '{"amount":1500}',
      channels: [
        { channel: 'email', enabled: true, subject: 'Paid', body: '<p>{{ amount }}</p>' },
        { channel: 'in_app', enabled: false, subject: 'Paid', body: '{{ amount }}' },
      ],
    },
    { type: 'welcome', channels: [] },
  ],
};

describe('template export and import', () => {
  it('imports what it exported, unchanged', async () => {
    await importTemplates(FILE);
    const before = await exported();
    expect(before.response.headers.get('content-disposition')).toContain('chaski-templates.json');

    await wipeTemplates();
    expect(await importTemplates(before.data)).toEqual({
      status: 200,
      body: {
        applied: true,
        changes: [
          { type: 'payment_received', change: 'create', fields: [], warnings: [] },
          { type: 'welcome', change: 'create', fields: [], warnings: [] },
        ],
      },
    });

    expect((await exported()).data).toEqual(before.data);
  });

  it('changes nothing when the same file is imported twice', async () => {
    await importTemplates(FILE);
    const stamped = await updatedAt('payment_received');

    const again = await importTemplates(FILE);

    expect(again.body.changes).toEqual([
      { type: 'payment_received', change: 'unchanged', fields: [], warnings: [] },
      { type: 'welcome', change: 'unchanged', fields: [], warnings: [] },
    ]);
    expect(await getClient().templates.count({ where: {} })).toBe(2);
    expect(await getClient().templateChannels.count({ where: {} })).toBe(2);
    expect(await updatedAt('payment_received')).toBe(stamped);
  });

  it('previews what an import would change without writing anything', async () => {
    await importTemplates(FILE);
    const before = await exported();

    const preview = await importTemplates(
      {
        ...FILE,
        templates: [
          {
            ...FILE.templates[0],
            topic: 'payments',
            channels: [
              { channel: 'email', enabled: true, subject: 'Received', body: '<p>{{ amount }}</p>' },
              { channel: 'push', enabled: true, subject: 'Paid', body: '{{ amount }}' },
            ],
          },
          FILE.templates[1],
          { type: 'invoice_due', channels: [] },
        ],
      },
      '?preview=true',
    );

    expect(preview).toEqual({
      status: 200,
      body: {
        applied: false,
        changes: [
          {
            type: 'payment_received',
            change: 'update',
            fields: ['topic', 'channels.email.subject', 'channels.push'],
            warnings: [],
          },
          { type: 'welcome', change: 'unchanged', fields: [], warnings: [] },
          { type: 'invoice_due', change: 'create', fields: [], warnings: [] },
        ],
      },
    });
    expect((await exported()).data).toEqual(before.data);
  });

  it('overwrites a template of the same type', async () => {
    await importTemplates(FILE);

    await importTemplates({
      ...FILE,
      templates: [
        {
          type: 'payment_received',
          topic: 'payments',
          channels: [{ channel: 'email', enabled: false, subject: 'Received', body: 'ok' }],
        },
      ],
    });

    const [payment] = (await exported()).data.templates ?? [];
    expect(payment).toMatchObject({ topic: 'payments', description: null });
    expect(payment?.channels).toEqual([
      expect.objectContaining({ channel: 'email', enabled: false, subject: 'Received' }),
      expect.objectContaining({ channel: 'in_app', enabled: false }),
    ]);
  });

  it('says where a file is wrong', async () => {
    const { status, body } = await importTemplates({
      format: 'chaski.templates',
      version: 1,
      templates: [{ type: 'ok' }, { type: 'bad type!' }],
    });

    expect(status).toBe(400);
    expect(body.message).toMatch(/^templates\.1\.type: /);
  });

  it('refuses a file that lists a type twice', async () => {
    const { status, body } = await importTemplates({
      ...FILE,
      templates: [{ type: 'welcome' }, { type: 'welcome' }],
    });

    expect(status).toBe(400);
    expect(body.message).toBe("templates.1.type: type 'welcome' appears more than once");
  });

  it('refuses another format or version', async () => {
    expect((await importTemplates({ ...FILE, version: 2 })).status).toBe(400);
    expect((await importTemplates({ ...FILE, format: 'other' })).status).toBe(400);
  });
});

// A host seeds and versions its templates from code (a seed script, CI, its own tests) without
// signing in to the dashboard.
describe('templates from the server', () => {
  it('imports a template file in process, after a preview that writes nothing', async () => {
    const preview = await chaski.templates.import(FILE, { preview: true });
    expect(preview).toEqual({
      applied: false,
      changes: [
        { type: 'payment_received', change: 'create', fields: [], warnings: [] },
        { type: 'welcome', change: 'create', fields: [], warnings: [] },
      ],
    });
    expect(await getClient().templates.count({ where: {} })).toBe(0);

    expect(await chaski.templates.import(FILE)).toMatchObject({ applied: true });
    expect((await chaski.templates.import(FILE)).changes.map((c) => c.change)).toEqual([
      'unchanged',
      'unchanged',
    ]);
    await expect(
      chaski.send({ type: 'payment_received', recipient: recipient(), payload: { amount: 1 } }),
    ).resolves.toMatchObject({ outcome: 'delivered' });
  });

  it('exports the same file the dashboard does', async () => {
    await chaski.templates.import(FILE);

    expect(await chaski.templates.export()).toEqual((await exported()).data);
  });

  it('works over the service binding', async () => {
    const rpc = exports.ChaskiEntrypoint;

    expect(await rpc.templates().import(FILE)).toMatchObject({ applied: true });
    expect((await rpc.templates().export()).templates.map((t) => t.type)).toEqual([
      'payment_received',
      'welcome',
    ]);
  });

  it('says where a file is wrong', async () => {
    await expect(
      chaski.templates.import({ ...FILE, templates: [{ type: 'bad type!' }] }),
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringMatching(/^templates\.0\.type: /),
    });
  });
});

// Content written for HTML often brings entities into fields people read as plain text.
describe('import warnings', () => {
  const ENTITIES: TemplateFile = {
    format: 'chaski.templates',
    version: 1,
    templates: [
      {
        type: 'booking_confirmed',
        channels: [
          {
            channel: 'email',
            enabled: true,
            subject: 'Booked &middot; {{ when }}',
            body: '<p>You&#8217;re booked &amp; set</p>',
            textBody: 'AT&T and Q&A stay quiet',
          },
          { channel: 'push', enabled: true, subject: 'You&#x2019;re booked', body: 'See you' },
        ],
      },
    ],
  };

  it('names each plain-text field that holds HTML entities, and writes it as it is', async () => {
    const preview = await chaski.templates.import(ENTITIES, { preview: true });
    const applied = await chaski.templates.import(ENTITIES);

    const warnings = [
      {
        field: 'channels.email.subject',
        code: 'html_entities',
        entities: ['&middot;'],
        message: 'channels.email.subject is plain text and shows &middot; as typed',
      },
      expect.objectContaining({ field: 'channels.push.subject', entities: ['&#x2019;'] }),
    ];
    expect(preview.changes[0]?.warnings).toEqual(warnings);
    expect(applied.changes[0]?.warnings).toEqual(warnings);
    const [stored] = (await chaski.templates.export()).templates;
    expect(stored?.channels?.find((c) => c.channel === 'email')?.subject).toBe(
      'Booked &middot; {{ when }}',
    );
  });
});
