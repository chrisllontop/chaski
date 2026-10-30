import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api as chaski } from '../src/server/api';
import { getClient } from '../src/server/db';
import { NotificationService } from '../src/server/services/notification.service';
import { fixtureConfig } from './fixture/worker';
import {
  api,
  processDeliveries,
  queuedMessages,
  recipient,
  seedTemplate,
  signedIn,
  stubEmail,
  useConfig,
} from './helpers';

const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  api(path, { method: 'POST', body: JSON.stringify(body), headers });

const pause = (channel: string, headers: Record<string, string> = {}) =>
  post(`/channels/${channel}/pause`, {}, headers);

const deliveryOf = async (notificationId: string, channel: string) =>
  getClient().deliveries.findFirst({ where: { notificationId, channel } });

const send = async (channels: Array<'email' | 'in_app'> = ['email', 'in_app']) => {
  const result = await NotificationService.send({
    type: 'payment_received',
    recipient: recipient(),
    payload: { amount: '$15' },
    channels,
  });
  await processDeliveries(result.notificationId);
  return result.notificationId;
};

const storedKeys = async () =>
  (await env.CHASKI_ATTACHMENTS.list({ prefix: 'att/' })).objects.map((object) => object.key);

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of await storedKeys()) await env.CHASKI_ATTACHMENTS.delete(key);
});

describe('pausing a channel', () => {
  it('holds its deliveries and lets the other channels deliver', async () => {
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'in_app');
    const sent = stubEmail();

    expect((await pause('email')).status).toBe(200);
    const notificationId = await send();

    expect(sent).toEqual([]);
    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ status: 'held' });
    expect(await deliveryOf(notificationId, 'in_app')).toMatchObject({ status: 'sent' });
    expect(await chaski.feed.unreadCount(recipient().id)).toEqual({ unread: 1 });
  });

  it('shows who paused it and when, and ready() lists it', async () => {
    await pause('in_app', signedIn({ email: 'ops@chaski.test', name: 'Ops' }));
    await pause('in_app', signedIn({ email: 'someone-else@chaski.test' }));

    const overview = (await (await api('/channels')).json()) as {
      channels: Array<{ channel: string; paused: unknown }>;
    };

    expect(overview.channels.find((c) => c.channel === 'in_app')?.paused).toEqual({
      pausedBy: { id: 'ops@chaski.test', name: 'Ops' },
      pausedAt: expect.any(String),
    });
    expect(overview.channels.find((c) => c.channel === 'email')?.paused).toBeNull();
    expect(await chaski.ready()).toMatchObject({ paused: ['in_app'] });
  });

  it('refuses a channel the config leaves out', async () => {
    useConfig({ channels: { email: fixtureConfig(env).channels?.email } });

    expect(await (await pause('in_app')).json()).toMatchObject({
      error: 'validation',
      message: 'the in_app channel is not configured',
    });
    expect((await pause('sms')).status).toBe(400);
  });
});

describe('resuming a channel', () => {
  it('sends what it held when asked to', async () => {
    await seedTemplate('payment_received', 'email');
    stubEmail();
    await pause('email');
    const notificationId = await send(['email']);
    const held = await deliveryOf(notificationId, 'email');

    const response = await post('/channels/email/resume', { send: true });

    expect(await response.json()).toEqual({ sent: 1 });
    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ status: 'pending' });
    expect(queuedMessages().map((message) => message.deliveryId)).toContain(held?.id);
  });

  it('keeps what it held for someone to send or discard, and sends nothing while paused', async () => {
    await seedTemplate('payment_received', 'email');
    stubEmail();
    await pause('email');
    const notificationId = await send(['email']);

    const early = await post('/deliveries/held/send', { channel: 'email' });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({
      message: 'email is paused: resume it to send what it holds, or discard it',
    });

    expect(await (await post('/channels/email/resume', { send: false })).json()).toEqual({
      sent: 0,
    });
    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ status: 'held' });

    expect(await (await post('/deliveries/held/send', { channel: 'email' })).json()).toEqual({
      sent: 1,
    });
    expect(await deliveryOf(notificationId, 'email')).toMatchObject({ status: 'pending' });
  });

  it('answers a channel that is not paused', async () => {
    expect((await post('/channels/email/resume', { send: true })).status).toBe(409);
  });
});

describe('discarding held deliveries', () => {
  it('skips them for good, with their attachments', async () => {
    await seedTemplate('payment_received', 'email');
    stubEmail();
    await pause('email');
    const result = await NotificationService.send({
      type: 'payment_received',
      recipient: recipient(),
      channels: ['email'],
      email: {
        attachments: [
          { filename: 'invite.ics', contentType: 'text/calendar', content: btoa('BEGIN') },
        ],
      },
    });
    await processDeliveries(result.notificationId);
    expect(await storedKeys()).toHaveLength(1);
    const held = await deliveryOf(result.notificationId, 'email');

    const response = await post('/deliveries/held/discard', { ids: [held?.id] });

    expect(await response.json()).toEqual({ discarded: 1 });
    expect(await deliveryOf(result.notificationId, 'email')).toMatchObject({
      status: 'skipped',
      skipReason: 'discarded',
    });
    expect(await storedKeys()).toEqual([]);
  });

  it('needs to know which ones', async () => {
    expect((await post('/deliveries/held/discard', {})).status).toBe(400);
  });
});

describe('an inline email on a paused channel', () => {
  const reset = () =>
    chaski.send({
      type: 'password_reset',
      recipient: recipient(),
      channels: ['email'],
      transactional: true,
      inline: true,
      idempotencyKey: 'reset:1',
    });

  it('throws channel_paused, holds the email, and goes out on a later try once resumed', async () => {
    await seedTemplate('password_reset', 'email');
    const sent = stubEmail();
    await pause('email');

    await expect(reset()).rejects.toMatchObject({
      code: 'channel_paused',
      message: expect.stringMatching(/^the email channel is paused: delivery d_\S+ is held/),
    });
    await expect(reset()).rejects.toMatchObject({ code: 'channel_paused' });
    expect(sent).toEqual([]);

    await post('/channels/email/resume', { send: false });
    await expect(reset()).resolves.toMatchObject({
      deliveries: [expect.objectContaining({ status: 'sent' })],
    });
    expect(sent).toHaveLength(1);
  });
});
