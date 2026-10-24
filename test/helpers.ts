import { exports } from 'cloudflare:workers';
import type { Channel } from '../src/contract/contract';
import { getClient } from '../src/server/db';

// A bare template row (no channel content): enough for a type to pass ingest
// validation while every channel still skips with no_template.
export const seedTemplateType = async (type: string, opts: { topic?: string | null } = {}) => {
  await getClient().templates.create({
    data: { id: `tpl_${type}`, type, topic: opts.topic ?? null },
    skipDuplicates: true,
  });
};

export const seedTemplate = async (type: string, channel: Channel) => {
  await seedTemplateType(type);
  await getClient().templateChannels.create({
    data: {
      id: `tc_${type}_${channel}`,
      templateId: `tpl_${type}`,
      channel,
      enabled: true,
      subject: 'Hello {{recipient.name}}',
      body: channel === 'email' ? '<p>Amount: {{amount}}</p>' : 'Amount: {{amount}}',
      textBody: 'Amount: {{amount}}',
    },
  });
};

export const recipient = (id = 'user_1') => ({ id, email: 'ana@example.com', name: 'Ana' });

// Admin API requests go through the fixture host, so they cross the same mount,
// guard and error handler a real host uses.
export const api = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(`https://host.test/chaski/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: 'https://host.test',
      ...init.headers,
    },
  });
