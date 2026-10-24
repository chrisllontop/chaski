import { describe, expect, it } from 'vitest';
import { query } from '../../src/dashboard/lib/api';
import {
  formatChange,
  formatPercent,
  formatRelative,
  formatUtcRange,
} from '../../src/dashboard/lib/format';

describe('dashboard query strings', () => {
  it('keeps only the filters that have a value', () => {
    expect(query({ status: 'dead', channel: undefined, type: '', page: 0, opened: false })).toBe(
      '?status=dead&page=0&opened=false',
    );
    expect(query({ recipientId: null })).toBe('');
  });
});

describe('dashboard formats', () => {
  it('shows rates with one decimal and – without a value', () => {
    expect(formatPercent(99.83)).toBe('99.8%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(null)).toBe('–');
  });

  it('signs changes, in percent or in points', () => {
    expect(formatChange(12.5)).toBe('+12.5%');
    expect(formatChange(-2.1, 'pts')).toBe('−2.1 pts');
    expect(formatChange(null)).toBeNull();
  });

  it('describes a time relative to now', () => {
    const now = Date.parse('2026-02-13T15:00:00Z');
    expect(formatRelative('2026-02-14T09:00:00Z', now)).toBe('in 18 hours');
    expect(formatRelative('2026-02-16T08:00:00Z', now)).toBe('in 3 days');
    expect(formatRelative('2026-02-13T14:30:00Z', now)).toBe('30 minutes ago');
  });

  it('labels metric windows in UTC', () => {
    expect(formatUtcRange('2026-01-15T00:00:00Z', '2026-02-13T23:59:00Z')).toBe(
      'Jan 15 – Feb 13, 2026 · UTC',
    );
  });
});
