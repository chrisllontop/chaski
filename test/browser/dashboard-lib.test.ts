import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_FILTERS } from '../../src/contract/liquid-filters';
import { query } from '../../src/dashboard/lib/api';
import { useDebounced } from '../../src/dashboard/lib/debounce';
import {
  formatChange,
  formatDuration,
  formatPercent,
  formatRelative,
  formatUtcRange,
} from '../../src/dashboard/lib/format';
import { healthByType } from '../../src/dashboard/lib/health';
import {
  LIQUID_FILTERS,
  liquidFilterPrefix,
  liquidNamesAt,
  liquidReference,
} from '../../src/dashboard/lib/liquid';
import { isOverdue } from '../../src/dashboard/lib/schedules';

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

  it('shows durations in the largest readable unit', () => {
    expect(formatDuration(840)).toBe('840 ms');
    expect(formatDuration(1430)).toBe('1.4 s');
    expect(formatDuration(12_400)).toBe('12 s');
    expect(formatDuration(150_000)).toBe('2.5 min');
    expect(formatDuration(9_000_000)).toBe('2.5 h');
    expect(formatDuration(null)).toBe('–');
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

describe('dashboard health', () => {
  it('rolls each type up to its worst channel, with paused below any channel that sent', () => {
    const health = healthByType([
      { type: 'welcome', health: 'healthy' },
      { type: 'welcome', health: 'at_risk' },
      { type: 'invoice_due', health: 'paused' },
      { type: 'invoice_due', health: 'healthy' },
      { type: 'digest', health: 'paused' },
    ]);
    expect(Object.fromEntries(health)).toEqual({
      welcome: 'at_risk',
      invoice_due: 'healthy',
      digest: 'paused',
    });
  });
});

describe('liquid completions', () => {
  const sample = { amount: 1500, invoice: { id: 'INV-1', lines: [] }, recipient: { name: 'Ana' } };

  it('offers the sample data, recipient and locale at the top level', () => {
    expect(liquidNamesAt(sample, [])).toEqual(['amount', 'invoice', 'locale', 'recipient']);
    expect(liquidNamesAt(null, [])).toEqual(['locale', 'recipient']);
  });

  it('offers Chaski’s filters after a pipe, the ones the server formats with', () => {
    expect(LIQUID_FILTERS.map((filter) => filter.name)).toEqual(
      LOCALE_FILTERS.map((filter) => filter.name),
    );
    expect(liquidFilterPrefix('{{ amount | cur')).toBe('cur');
    expect(liquidFilterPrefix('{{ amount |')).toBe('');
    expect(liquidFilterPrefix('{% assign total = amount | num')).toBe('num');
    expect(liquidFilterPrefix('{{ amount }} | cur')).toBeNull();
    expect(liquidFilterPrefix('{{ amount')).toBeNull();
  });

  it('offers the fields under a dotted path, recipient’s included', () => {
    expect(liquidNamesAt(sample, ['invoice'])).toEqual(['id', 'lines']);
    expect(liquidNamesAt(sample, ['recipient'])).toEqual([
      'email',
      'id',
      'locale',
      'name',
      'phone',
      'timezone',
    ]);
    expect(liquidNamesAt(sample, ['amount'])).toEqual([]);
    expect(liquidNamesAt(sample, ['missing', 'deeper'])).toEqual([]);
  });
});

describe('useDebounced', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles once the value holds still, and ignores copies of the same value', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounced(value), {
      initialProps: { value: { body: 'a' } },
    });
    const first = result.current;

    rerender({ value: { body: 'a' } });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(first);

    rerender({ value: { body: 'ab' } });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current).toEqual({ body: 'a' });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ body: 'ab' });
  });
});

describe('liquid references', () => {
  it('reads the dotted path being typed inside an open tag', () => {
    expect(liquidReference('<p>{{ recipient.na')).toEqual({ path: ['recipient'], prefix: 'na' });
    expect(liquidReference('<p>{{- amo')).toEqual({ path: [], prefix: 'amo' });
    expect(liquidReference('{% if invoice.')).toEqual({ path: ['invoice'], prefix: '' });
  });

  it('stays out of closed tags, tag names and filters', () => {
    expect(liquidReference('<p>{{ amount }} and')).toBeNull();
    expect(liquidReference('<p>plain text')).toBeNull();
    expect(liquidReference('{% i')).toBeNull();
    expect(liquidReference('{{ amount | upc')).toBeNull();
  });
});

describe('overdue schedules', () => {
  const now = Date.parse('2026-10-27T06:00:00Z');

  it('flags a pending schedule a minute past its time, not one firing now', () => {
    expect(isOverdue('2026-10-27T05:58:30Z', now)).toBe(true);
    expect(isOverdue('2026-10-27T05:59:30Z', now)).toBe(false);
    expect(isOverdue('2026-10-27T06:30:00Z', now)).toBe(false);
  });
});
