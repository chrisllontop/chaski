import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  timeZoneOr,
} from '../../src/contract/liquid-filters';

// Intl separates a currency symbol, and a time from AM or PM, with no-break spaces.
const spaced = (value: unknown) => String(value).replace(/[\u00a0\u202f]/g, ' ');

// The formats the server's Liquid filters write, run here in a page as the dashboard runs them.
describe('locale filters', () => {
  const en = { locale: 'en' };
  const es = { locale: 'es' };

  it('formats numbers as each language writes them', () => {
    expect(formatNumber(1500, en)).toBe('1,500');
    expect(formatNumber(1_234_567.891, es)).toBe('1.234.567,891');
    expect(formatNumber('1500.5', en, 2)).toBe('1,500.50');
    expect(() => formatNumber(1, en, 21)).toThrowError(/from 0 to 20/);
  });

  it('formats money in the currency named, as each language writes it', () => {
    expect(formatCurrency(1500, en, 'USD')).toBe('$1,500.00');
    expect(spaced(formatCurrency(1500, { locale: 'es-PE' }, 'PEN'))).toBe('S/ 1,500.00');
    expect(spaced(formatCurrency(1500, es, 'usd'))).toBe('1500,00 US$');
    expect(() => formatCurrency(1500, en)).toThrowError(/ISO 4217 code/);
  });

  it('formats dates in the contact’s timezone, UTC without one', () => {
    const paidAt = '2026-10-30T03:30:00Z';
    expect(formatDate(paidAt, es)).toBe('30 de octubre de 2026');
    expect(formatDate(paidAt, { locale: 'es', timeZone: 'America/Lima' })).toBe(
      '29 de octubre de 2026',
    );
    expect(
      spaced(formatDate(paidAt, { locale: 'en', timeZone: 'America/Lima' }, 'medium', 'short')),
    ).toBe('Oct 29, 2026, 10:30 PM');
    expect(spaced(formatDate(1_793_331_000, en, 'none', 'short'))).toBe('3:30 AM');
    expect(() => formatDate(paidAt, en, 'none')).toThrowError(/not 'none' twice/);
    expect(() => formatDate(paidAt, en, 'longest')).toThrowError(/first style is one of/);
  });

  it('prints a value it can’t read as it came, as Liquid’s date filter does', () => {
    expect(formatNumber('soon', en)).toBe('soon');
    expect(formatCurrency(undefined, en, 'USD')).toBeUndefined();
    expect(formatDate('not a date', en)).toBe('not a date');
    expect(timeZoneOr('Mars/Olympus_Mons')).toBe('UTC');
  });
});
