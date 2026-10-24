import { env, exports } from 'cloudflare:workers';
import { vi } from 'vitest';
import {
  type ChaskiConfig,
  createChaski,
  type DeliveryMessage,
  type SendEmailBinding,
} from '../src';
import type { Channel } from '../src/contract/contract';
import { getClient } from '../src/server/db';
import { DeliveryService } from '../src/server/services/delivery.service';
import { fixtureConfig } from './fixture/worker';

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
      // Email keeps its plain-text body here; in_app and push keep the link they open.
      textBody: channel === 'email' ? 'Amount: {{amount}}' : '/payments/{{amount}}',
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

// Sends always enqueue; tests that assert on delivery outcomes drain the
// pending deliveries through the same code path the queue consumer runs.
export const processDeliveries = async (notificationId: string): Promise<void> => {
  const client = getClient();
  const notification = await client.notifications.findFirst({ where: { id: notificationId } });
  if (!notification) return;
  const deliveries = await client.deliveries.findMany({ where: { notificationId } });
  for (const delivery of deliveries) {
    if (delivery.status !== 'pending') continue;
    await DeliveryService.process({
      kind: 'chaski.delivery',
      deliveryId: delivery.id,
      notificationId,
      channel: delivery.channel,
      type: notification.type,
      recipientId: notification.recipientId,
    });
  }
};

// The messages the stubbed producer received (see setup.ts).
export const queuedMessages = (): DeliveryMessage[] =>
  vi
    .mocked(env.CHASKI_QUEUE.sendBatch)
    .mock.calls.flatMap(([messages]) => [...messages].map((message) => message.body));

// Registers Chaski again with the fixture's config plus the overrides; the
// fixture Worker shares this isolate, so its routes and queue see it too.
export const useConfig = (overrides: Partial<ChaskiConfig> = {}) =>
  createChaski(() => ({ ...fixtureConfig(env), ...overrides }));

export type SentEmail = Parameters<SendEmailBinding['send']>[0];

export const stubEmail = (
  send: (message: SentEmail) => Promise<{ messageId: string }> = async () => ({
    messageId: 'msg_1',
  }),
) => {
  const sent: SentEmail[] = [];
  vi.spyOn(env.CHASKI_EMAIL, 'send').mockImplementation(async (message) => {
    sent.push(message);
    return send(message);
  });
  return sent;
};
