import { describe, expect, it } from 'vitest';
import { type ResolveInput, resolveChannels } from '../src/server/lib/resolve-channels';

const base = (overrides: Partial<ResolveInput> = {}): ResolveInput => ({
  requestedChannels: undefined,
  transactional: false,
  type: 'payment_received',
  enabledChannels: ['email'],
  preferences: null,
  contact: { email: 'a@b.com' },
  capabilities: { push: true },
  templatesByChannel: { email: true, in_app: true, push: true },
  ...overrides,
});

describe('resolveChannels', () => {
  it('targets every configured channel when the request omits channels', () => {
    const result = resolveChannels(base({ enabledChannels: ['email', 'in_app', 'push'] }));
    expect(result).toEqual([{ channel: 'email' }, { channel: 'in_app' }, { channel: 'push' }]);
  });

  it('skips channels the host has not configured', () => {
    const result = resolveChannels(base({ requestedChannels: ['email', 'push'] }));
    expect(result).toContainEqual({ channel: 'push', skipReason: 'channel_not_configured' });
    expect(result).toContainEqual({ channel: 'email' });
  });

  it('applies stored preferences even when channels are explicit', () => {
    const result = resolveChannels(
      base({
        requestedChannels: ['email'],
        preferences: { channels: { email: false }, mutedTypes: [] },
      }),
    );
    expect(result).toEqual([{ channel: 'email', skipReason: 'muted_by_preferences' }]);
  });

  it('applies channel preferences when channels are omitted', () => {
    const result = resolveChannels(
      base({ preferences: { channels: { email: false }, mutedTypes: [] } }),
    );
    expect(result).toEqual([{ channel: 'email', skipReason: 'muted_by_preferences' }]);
  });

  it('applies muted type wildcards', () => {
    const result = resolveChannels(
      base({
        type: 'marketing_weekly',
        preferences: { channels: {}, mutedTypes: ['marketing_*'] },
      }),
    );
    expect(result).toEqual([{ channel: 'email', skipReason: 'muted_by_preferences' }]);
  });

  it('applies channel-scoped muted types to that channel only', () => {
    const result = resolveChannels(
      base({
        type: 'class_reminder',
        enabledChannels: ['email', 'push'],
        preferences: { channels: {}, mutedTypes: ['push:class_reminder'] },
      }),
    );
    expect(result).toContainEqual({ channel: 'email' });
    expect(result).toContainEqual({ channel: 'push', skipReason: 'muted_by_preferences' });
  });

  it('supports wildcards in channel-scoped muted types', () => {
    const result = resolveChannels(
      base({
        type: 'reminder.class_24h',
        preferences: { channels: {}, mutedTypes: ['email:reminder.*'] },
      }),
    );
    expect(result).toEqual([{ channel: 'email', skipReason: 'muted_by_preferences' }]);
  });

  it('treats an unknown prefix as a literal type pattern, not a channel', () => {
    const result = resolveChannels(
      base({
        type: 'sms_alert',
        preferences: { channels: {}, mutedTypes: ['sms:alert'] },
      }),
    );
    expect(result).toEqual([{ channel: 'email' }]);
  });

  it('bypasses preferences for transactional sends', () => {
    const result = resolveChannels(
      base({
        transactional: true,
        requestedChannels: ['email'],
        preferences: { channels: { email: false }, mutedTypes: ['payment_received'] },
      }),
    );
    expect(result).toEqual([{ channel: 'email' }]);
  });

  it('skips a channel whose template has no live content', () => {
    const result = resolveChannels(base({ requestedChannels: ['email'], templatesByChannel: {} }));
    expect(result).toEqual([{ channel: 'email', skipReason: 'no_template' }]);
  });

  it('skips email when the contact has none', () => {
    const result = resolveChannels(base({ contact: {} }));
    expect(result).toEqual([{ channel: 'email', skipReason: 'missing_email' }]);
  });
});
