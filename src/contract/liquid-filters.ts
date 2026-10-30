// Chaski's own Liquid filters, which format numbers, money and dates for the language a delivery
// renders in. The server registers them on its Liquid engines and the dashboard's editor offers
// them, so both read this one list. Names stay clear of Liquid's built-ins (`date` is strftime).

/** The language a delivery renders in, and the contact's timezone when the send gave a valid one. */
export type LocaleFormat = { locale: string; timeZone?: string };

const DATE_STYLES = ['full', 'long', 'medium', 'short', 'none'] as const;
type DateStyle = (typeof DATE_STYLES)[number];

// A value that isn't a number (an empty payload key, a typo in the data) prints as it came, the
// way Liquid's date filter leaves a value it can't read. An argument the template's author wrote
// wrong fails the render instead: the preview shows why, and the delivery fails for good.
const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// As Liquid's date filter reads them: a number, or a string of digits, counts seconds since the
// epoch, and `now` and `today` are the moment of rendering.
const toDate = (value: unknown): Date | null => {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number') date = new Date(value * 1000);
  else if (typeof value === 'string') {
    if (value === 'now' || value === 'today') date = new Date();
    else if (/^\d+$/.test(value)) date = new Date(Number(value) * 1000);
    else if (value.trim() !== '') date = new Date(value);
  }
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const isTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** The contact's IANA timezone, or UTC when there is none or Intl doesn't know it. */
export const timeZoneOr = (timeZone: string | null | undefined): string =>
  timeZone && isTimeZone(timeZone) ? timeZone : 'UTC';

const styleOf = (value: unknown, fallback: DateStyle | undefined, position: string) => {
  if (value === undefined || value === null) return fallback;
  if ((DATE_STYLES as readonly unknown[]).includes(value)) return value as DateStyle;
  throw new Error(`format_date's ${position} style is one of ${DATE_STYLES.join(', ')}`);
};

/** `{{ count | number }}`, or `{{ ratio | number: 2 }}` for exactly two decimals. */
export const formatNumber = (value: unknown, format: LocaleFormat, decimals?: unknown): unknown => {
  const number = toNumber(value);
  if (number === null) return value;
  if (decimals === undefined || decimals === null) {
    return new Intl.NumberFormat(format.locale).format(number);
  }
  if (!Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 20) {
    throw new Error('number takes how many decimals to show, from 0 to 20');
  }
  const digits = decimals as number;
  return new Intl.NumberFormat(format.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
};

/** `{{ amount | currency: 'USD' }}`: the amount in that currency, as the language writes money. */
export const formatCurrency = (
  value: unknown,
  format: LocaleFormat,
  currency?: unknown,
): unknown => {
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
    throw new Error("currency takes an ISO 4217 code, such as currency: 'USD'");
  }
  const number = toNumber(value);
  if (number === null) return value;
  return new Intl.NumberFormat(format.locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(number);
};

/**
 * `{{ paidAt | format_date }}` is the date in the long style; a second argument adds the time:
 * `format_date: 'medium', 'short'`, and `'none'` leaves the date out. In the contact's timezone.
 */
export const formatDate = (
  value: unknown,
  format: LocaleFormat,
  dateStyle?: unknown,
  timeStyle?: unknown,
): unknown => {
  const date = toDate(value);
  if (!date) return value;
  const dateOption = styleOf(dateStyle, 'long', 'first');
  const timeOption = styleOf(timeStyle, 'none', 'second');
  if (dateOption === 'none' && timeOption === 'none') {
    throw new Error("format_date needs a date style, a time style or both, not 'none' twice");
  }
  return new Intl.DateTimeFormat(format.locale, {
    timeZone: timeZoneOr(format.timeZone),
    ...(dateOption === 'none' ? {} : { dateStyle: dateOption }),
    ...(timeOption === 'none' ? {} : { timeStyle: timeOption }),
  }).format(date);
};

export const LOCALE_FILTERS = [
  {
    name: 'number',
    usage: 'number: decimals',
    format: (value: unknown, format: LocaleFormat, ...args: unknown[]) =>
      formatNumber(value, format, args[0]),
  },
  {
    name: 'currency',
    usage: "currency: 'USD'",
    format: (value: unknown, format: LocaleFormat, ...args: unknown[]) =>
      formatCurrency(value, format, args[0]),
  },
  {
    name: 'format_date',
    usage: "format_date: 'long', 'short'",
    format: (value: unknown, format: LocaleFormat, ...args: unknown[]) =>
      formatDate(value, format, args[0], args[1]),
  },
] as const;
