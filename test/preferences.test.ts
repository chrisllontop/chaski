import { describe, expect, it } from 'vitest';
import { api as chaski } from '../src/server/api';
import { recipient, seedTemplate, seedTemplateType, useConfig } from './helpers';

const send = (type = 'payment_received', extra = {}) =>
  chaski.send({ type, recipient: recipient(), payload: { amount: 10 }, ...extra });

const statuses = async (type?: string, extra = {}) =>
  (await send(type, extra)).deliveries.map((d) => [d.channel, d.reason ?? d.status]);

describe('preferences', () => {
  it('starts from the host defaults', async () => {
    useConfig({ defaultMutedTypes: ['marketing.*'] });

    expect(await chaski.preferences.get('user_1')).toEqual({
      channels: {},
      mutedTypes: ['marketing.*'],
    });
  });

  it('merges channels key by key and overwrites the muted types', async () => {
    await chaski.preferences.set('user_1', {
      channels: { email: false },
      mutedTypes: ['digest'],
    });

    const next = await chaski.preferences.set('user_1', {
      channels: { push: false },
      mutedTypes: ['reminder.*'],
    });

    expect(next).toEqual({ channels: { email: false, push: false }, mutedTypes: ['reminder.*'] });
    expect(await chaski.preferences.get('user_1')).toEqual(next);
  });

  it('rejects an empty recipient id and unknown channels', async () => {
    await expect(chaski.preferences.get('')).rejects.toMatchObject({ code: 'validation' });
    await expect(
      chaski.preferences.set('user_1', { channels: { sms: false } as never }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('groups template types by topic', async () => {
    await seedTemplateType('payment_received', { topic: 'billing' });
    await seedTemplateType('invoice_due', { topic: 'billing' });
    await seedTemplateType('welcome');

    expect(await chaski.preferences.topics()).toEqual([
      { topic: 'billing', types: ['invoice_due', 'payment_received'] },
      { topic: null, types: ['welcome'] },
    ]);
  });
});

describe('preferences at send time', () => {
  it('skips a channel the recipient turned off and reports the send suppressed', async () => {
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'in_app');
    await chaski.preferences.set('user_1', { channels: { email: false, in_app: false } });

    const result = await send();

    expect(result.outcome).toBe('suppressed');
    expect(result.deliveries.map((d) => d.reason)).toEqual([
      'muted_by_preferences',
      'muted_by_preferences',
    ]);
  });

  it('mutes a type on one channel with a channel prefix', async () => {
    await seedTemplate('payment_received', 'email');
    await seedTemplate('payment_received', 'in_app');
    await chaski.preferences.set('user_1', { mutedTypes: ['email:payment_*'] });

    expect(await statuses()).toEqual([
      ['email', 'muted_by_preferences'],
      ['in_app', 'pending'],
    ]);
  });

  it('applies the host default mutes until the recipient saves their own', async () => {
    useConfig({ defaultMutedTypes: ['payment_*'] });
    await seedTemplate('payment_received', 'in_app');

    expect(await statuses('payment_received', { channels: ['in_app'] })).toEqual([
      ['in_app', 'muted_by_preferences'],
    ]);

    await chaski.preferences.set('user_1', { mutedTypes: [] });
    expect(await statuses('payment_received', { channels: ['in_app'] })).toEqual([
      ['in_app', 'pending'],
    ]);
  });

  it('ignores preferences for transactional sends', async () => {
    await seedTemplate('payment_received', 'in_app');
    await chaski.preferences.set('user_1', { channels: { in_app: false } });

    expect(await statuses('payment_received', { transactional: true })).toEqual([
      ['email', 'no_template'],
      ['in_app', 'pending'],
    ]);
  });
});
