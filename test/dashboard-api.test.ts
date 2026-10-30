import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api as chaski } from '../src/server/api';
import { getClient } from '../src/server/db';
import { api, processDeliveries, recipient, seedTemplate, signedIn, stubEmail } from './helpers';

type Json = Record<string, unknown> & {
  actor?: unknown;
  schedules?: Array<{ id: string; recipientId: string }>;
  templates?: Array<{ type: string; contentUpdatedAt: string; updatedAt: string }>;
  deliveries?: Array<{ id: string }>;
  total?: number;
};

const json = async (path: string, init?: RequestInit) => {
  const response = await api(path, init);
  return { status: response.status, body: (await response.json()) as Json };
};

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/me', () => {
  it('answers with the actor Access signed in', async () => {
    const { body } = await json('/me', {
      headers: signedIn({ email: 'ana@example.com', name: 'Ana' }),
    });

    expect(body).toEqual({ actor: { id: 'ana@example.com', name: 'Ana' } });
  });
});

describe('/api/schedules', () => {
  const schedule = (recipientId: string, hours: number, groupKey?: string) =>
    chaski.schedule({
      type: 'payment_received',
      recipient: recipient(recipientId),
      channels: ['in_app'],
      scheduledAt: inHours(hours),
      groupKey,
    });

  it('pages through pending schedules soonest first, with filters', async () => {
    await seedTemplate('payment_received', 'in_app');
    const later = await schedule('user_1', 48, 'trial');
    const sooner = await schedule('user_1', 2, 'trial');
    await schedule('user_2', 24);

    const firstPage = await json('/schedules?limit=2');
    expect(firstPage.body).toMatchObject({ total: 3, page: 0, limit: 2 });
    expect(firstPage.body.schedules?.map((s) => s.id)).toEqual([
      sooner.scheduledId,
      expect.any(String),
    ]);

    const byGroup = await json('/schedules?groupKey=trial');
    expect(byGroup.body.schedules?.map((s) => s.id)).toEqual([
      sooner.scheduledId,
      later.scheduledId,
    ]);
    expect((await json('/schedules?recipientId=user_2')).body.total).toBe(1);
  });

  it('cancels one schedule, once', async () => {
    await seedTemplate('payment_received', 'in_app');
    const { scheduledId } = await schedule('user_1', 2);

    expect((await json(`/schedules/${scheduledId}/cancel`, { method: 'POST' })).body).toEqual({
      cancelled: 1,
    });
    expect((await json(`/schedules/${scheduledId}/cancel`, { method: 'POST' })).body).toEqual({
      cancelled: 0,
    });
    expect((await json('/schedules')).body.total).toBe(0);
  });
});

describe('deleted templates', () => {
  const createWelcome = async () =>
    (await json('/templates', { method: 'POST', body: JSON.stringify({ type: 'welcome' }) })).body
      .template as { id: string };

  it('restores a deleted template', async () => {
    const template = await createWelcome();
    await api(`/templates/${template.id}`, { method: 'DELETE' });

    const restored = await json(`/templates/${template.id}/restore`, { method: 'POST' });

    expect(restored.status).toBe(200);
    expect((await json('/templates')).body.templates?.map((t) => t.type)).toEqual(['welcome']);
  });

  it('refuses to restore over a live template of the same type', async () => {
    const first = await createWelcome();
    await api(`/templates/${first.id}`, { method: 'DELETE' });
    await createWelcome();

    const restored = await json(`/templates/${first.id}/restore`, { method: 'POST' });

    expect(restored.status).toBe(409);
    expect(restored.body.message).toContain("a live template already has type 'welcome'");
  });

  it('deletes permanently only what is already deleted', async () => {
    const template = await createWelcome();

    expect((await json(`/templates/${template.id}/permanent`, { method: 'DELETE' })).status).toBe(
      404,
    );
    await api(`/templates/${template.id}`, { method: 'DELETE' });
    expect((await json(`/templates/${template.id}/permanent`, { method: 'DELETE' })).body).toEqual({
      id: template.id,
      purged: true,
    });
    expect((await json('/templates/deleted')).body.templates).toEqual([]);
  });
});

describe('template editing', () => {
  it('reports the latest edit of the template or any of its channels', async () => {
    await seedTemplate('payment_received', 'email');
    // Straight SQL: the client would stamp updatedAt with now.
    await env.CHASKI_DB.prepare('UPDATE templates SET updated_at = ?')
      .bind(Date.UTC(2026, 0, 1))
      .run();
    await env.CHASKI_DB.prepare('UPDATE template_channels SET updated_at = ?')
      .bind(Date.UTC(2026, 1, 1))
      .run();

    const [template] = (await json('/templates')).body.templates ?? [];

    expect(template?.contentUpdatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('previews content that is not saved yet', async () => {
    await seedTemplate('payment_received', 'email');
    const template = await getClient().templates.findFirst({
      where: { type: 'payment_received' },
    });

    const { body } = await json(`/templates/${template?.id}/preview`, {
      method: 'POST',
      body: JSON.stringify({
        channel: 'email',
        data: { amount: 42 },
        content: { subject: 'Draft {{ amount }}', body: '<p>{{ amount }} draft</p>' },
      }),
    });

    expect(body).toMatchObject({ subject: 'Draft 42', html: '<p>42 draft</p>' });
  });
});

describe('email preview document', () => {
  it('renders unsaved email HTML under its own sandboxed CSP', async () => {
    await seedTemplate('payment_received', 'email');
    const template = await getClient().templates.findFirst({
      where: { type: 'payment_received' },
    });
    const form = new URLSearchParams({
      subject: 'Paid',
      body: '<p style="color:red">{{ amount }} paid</p>',
      data: JSON.stringify({ amount: 42 }),
    });

    const response = await api(`/templates/${template?.id}/preview/document`, {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain('sandbox');
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('script-src');
    expect(await response.text()).toBe('<p style="color:red">42 paid</p>');
  });

  it('refuses sample data that is not a JSON object', async () => {
    await seedTemplate('payment_received', 'email');
    const template = await getClient().templates.findFirst({
      where: { type: 'payment_received' },
    });

    const response = await api(`/templates/${template?.id}/preview/document`, {
      method: 'POST',
      body: new URLSearchParams({ body: '<p>x</p>', data: '[1, 2]' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.status).toBe(400);
  });

  it('keeps previews out of the admin action log', async () => {
    await seedTemplate('payment_received', 'email');
    const template = await getClient().templates.findFirst({
      where: { type: 'payment_received' },
    });
    const info = vi.spyOn(console, 'info');

    await api(`/templates/${template?.id}/preview`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'email', data: { amount: 1 } }),
    });

    expect(info).not.toHaveBeenCalledWith('[chaski:admin]', 'admin action', expect.anything());
  });
});

describe('deliveries by time', () => {
  it('lists the latest change first and filters by when it happened', async () => {
    await seedTemplate('payment_received', 'email');
    stubEmail();
    const first = await chaski.send({ type: 'payment_received', recipient: recipient('user_1') });
    const second = await chaski.send({ type: 'payment_received', recipient: recipient('user_2') });
    await processDeliveries(second.notificationId);
    await processDeliveries(first.notificationId);
    const [firstId] = first.deliveries.map((d) => d.id);
    const [secondId] = second.deliveries.map((d) => d.id);
    // Pinned with SQL, so the two changes never share a millisecond.
    for (const [id, minutesAgo] of [
      [firstId, 1],
      [secondId, 2],
    ] as const) {
      await env.CHASKI_DB.prepare('UPDATE deliveries SET updated_at = ? WHERE id = ?')
        .bind(Date.now() - minutesAgo * 60_000, id ?? '')
        .run();
    }

    const listed = await json('/deliveries?channel=email');
    expect(listed.body.deliveries?.[0]?.id).toBe(firstId);

    const future = encodeURIComponent(inHours(1));
    expect((await json(`/deliveries?from=${future}`)).body.total).toBe(0);
    expect((await json(`/deliveries/counts?to=${future}`)).body).toEqual({
      counts: { sent: 2, skipped: 2 },
    });
    expect((await json('/deliveries?from=2026-01-01T00:00:00')).status).toBe(400);
  });
});
