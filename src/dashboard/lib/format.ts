import type { Channel } from './types';

const numberFormat = new Intl.NumberFormat('en-US');

export const formatNumber = (value: number) => numberFormat.format(value);

/** The server rounds rates to two decimals; one is enough to read them. */
export const formatPercent = (value: number | null) =>
  value === null ? '–' : `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

export const formatChange = (value: number | null, unit: '%' | 'pts' = '%') => {
  if (value === null) return null;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  const magnitude = Math.abs(value);
  return unit === '%' ? `${sign}${magnitude}%` : `${sign}${magnitude.toFixed(1)} pts`;
};

const oneDecimal = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 10 ? String(Math.round(rounded)) : String(rounded);
};

/** Milliseconds in the largest unit that keeps them readable: 840 ms, 1.4 s, 12 min, 2.5 h. */
export const formatDuration = (ms: number | null) => {
  if (ms === null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${oneDecimal(ms / 1000)} s`;
  if (ms < 3_600_000) return `${oneDecimal(ms / 60_000)} min`;
  return `${oneDecimal(ms / 3_600_000)} h`;
};

const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const formatDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '–');

const utcDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const utcDayYear = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Metric windows are counted in UTC days, so their dates are shown in UTC. */
export const formatUtcDay = (iso: string) => utcDay.format(new Date(iso));

export const formatUtcRange = (from: string, to: string) =>
  `${utcDay.format(new Date(from))} – ${utcDayYear.format(new Date(to))} · UTC`;

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export const formatRelative = (iso: string, now = Date.now()) => {
  const delta = new Date(iso).getTime() - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) return relative.format(Math.round(delta / size), unit);
  }
  return relative.format(Math.round(delta / 1000), 'second');
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  in_app: 'In-app',
  push: 'Push',
};
