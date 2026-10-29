import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/server/db';
import { chaski } from './fixture/worker';
import { recipient, seedTemplate, stubEmail } from './helpers';

describe('send through the real queue', () => {
  it('delivers to the in-app feed and through the email binding', async () => {
    // Let the fixture's own consumer pick the messages up from the queue.
    vi.mocked(env.CHASKI_QUEUE.sendBatch).mockRestore();
    vi.mocked(env.CHASKI_QUEUE.send).mockRestore();
    const sent = stubEmail();
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'in_app');

    const result = await chaski.send({
      type: 'payment_received',
      recipient: recipient(),
      payload: { amount: 1500 },
    });
    expect(result.deliveries.map((d) => [d.channel, d.status])).toEqual([
      ['email', 'pending'],
      ['in_app', 'pending'],
    ]);

    await vi.waitFor(
      async () => {
        const deliveries = await getClient().deliveries.findMany({
          where: { notificationId: result.notificationId },
        });
        expect(deliveries.map((d) => [d.channel, d.status]).sort()).toEqual([
          ['email', 'sent'],
          ['in_app', 'sent'],
        ]);
      },
      { timeout: 10_000, interval: 100 },
    );

    const email = await getClient().deliveries.findFirst({
      where: { notificationId: result.notificationId, channel: 'email' },
    });
    expect(email?.providerMessageId).toBe('msg_1');
    expect(sent).toEqual([expect.objectContaining({ to: recipient().email })]);
    const feed = await chaski.feed.list({ recipientId: 'user_1' });
    expect(feed.items).toEqual([
      expect.objectContaining({ title: 'Hello Ana', body: 'Amount: 1500' }),
    ]);
  });
});
