import { describe, expect, it } from 'vitest';
import { api } from './helpers';

const createWelcome = async () => {
  const response = await api('/templates', {
    method: 'POST',
    body: JSON.stringify({ type: 'welcome', topic: 'account', channels: ['email'] }),
  });
  return ((await response.json()) as { template: { id: string } }).template;
};

describe('templates API', () => {
  it('creates a template and lists it with its channels', async () => {
    const template = await createWelcome();

    const response = await api('/templates');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      templates: [
        {
          id: template.id,
          type: 'welcome',
          topic: 'account',
          lastUsedAt: null,
          channels: [{ channel: 'email', enabled: false }],
        },
      ],
    });
  });

  it('rejects a duplicate type with a conflict', async () => {
    await createWelcome();

    const response = await api('/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'welcome' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'conflict' });
  });

  it('rejects an invalid type name', async () => {
    const response = await api('/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'has spaces' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation' });
  });

  it('renders a channel preview with Liquid', async () => {
    const template = await createWelcome();
    await api(`/templates/${template.id}/channels/email`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, subject: 'Hi {{ name }}', body: '<p>{{ name }}</p>' }),
    });

    const response = await api(`/templates/${template.id}/preview`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'email', data: { name: 'Ana' } }),
    });

    expect(await response.json()).toEqual({ subject: 'Hi Ana', html: '<p>Ana</p>' });
  });

  it('soft-deletes a template and lists it among the deleted ones', async () => {
    const template = await createWelcome();

    const deleted = await api(`/templates/${template.id}`, { method: 'DELETE' });
    expect(await deleted.json()).toEqual({ id: template.id, deleted: true });

    expect(await (await api('/templates')).json()).toEqual({ templates: [] });
    expect(await (await api('/templates/deleted')).json()).toMatchObject({
      templates: [{ id: template.id, type: 'welcome' }],
    });
  });

  it('answers 404 for an unknown template', async () => {
    const response = await api('/templates/tpl_missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
  });
});
