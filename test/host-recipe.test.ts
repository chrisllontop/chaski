// The Vitest recipe in site/content/docs/local-development.mdx, kept runnable: it uses only what
// a host has, the package's public API and cloudflare:test, so the page stays true.
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { DeliveryMessage, SendEmailBinding, TemplateFile } from '../src';
import { chaski } from './fixture/worker';

// Holds what Chaski puts on the queue, then hands it to chaski.queue() as the consumer would.
const captureDeliveries = () => {
  const queued: DeliveryMessage[] = [];
  vi.spyOn(env.CHASKI_QUEUE, 'sendBatch').mockImplementation(async (messages) => {
    for (const message of messages) queued.push(message.body);
    return { metadata: { metrics: { backlogCount: queued.length, backlogBytes: 0 } } };
  });
  return async () => {
    const batch = createMessageBatch(
      'chaski-deliveries',
      queued.splice(0).map((body, index) => ({
        id: String(index),
        timestamp: new Date(),
        attempts: 1,
        body,
      })),
    );
    const ctx = createExecutionContext();
    await chaski.queue(batch, env, ctx);
    return getQueueResult(batch, ctx);
  };
};

const TEMPLATES: TemplateFile = {
  format: 'chaski.templates',
  version: 1,
  templates: [
    {
      type: 'welcome',
      channels: [
        { channel: 'email', enabled: true, subject: 'Welcome, {{ recipient.name }}', body: 'Hi' },
        { channel: 'in_app', enabled: true, subject: 'Welcome', body: 'Your account is ready.' },
      ],
    },
  ],
};

describe('the host testing recipe', () => {
  it('sends, drains the queue and checks the email and the feed', async () => {
    await chaski.templates.import(TEMPLATES);
    const drain = captureDeliveries();
    const emails: Array<Parameters<SendEmailBinding['send']>[0]> = [];
    vi.spyOn(env.CHASKI_EMAIL, 'send').mockImplementation(async (message) => {
      emails.push(message);
      return { messageId: 'test' };
    });

    await chaski.send({
      type: 'welcome',
      recipient: { id: 'user_1', email: 'ana@example.com', name: 'Ana' },
    });
    const result = await drain();

    expect(result.explicitAcks).toHaveLength(2);
    expect(emails).toEqual([expect.objectContaining({ subject: 'Welcome, Ana' })]);
    expect(await chaski.feed.unreadCount('user_1')).toEqual({ unread: 1 });
  });
});
