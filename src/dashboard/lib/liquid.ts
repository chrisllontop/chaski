import { LOCALE_FILTERS } from '../../contract/liquid-filters';

// Sends render with the payload's keys plus `recipient`, the contact's snapshot, and `locale`, the
// language the content renders in once the Worker has languages.
const RECIPIENT_FIELDS = ['id', 'email', 'name', 'phone', 'timezone', 'locale'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The names a template can reach at a dotted path, from the sample data and `recipient`. */
export const liquidNamesAt = (sample: Record<string, unknown> | null, path: readonly string[]) => {
  const recipient = isRecord(sample?.recipient) ? sample.recipient : {};
  const scope: Record<string, unknown> = {
    locale: '',
    ...sample,
    recipient: { ...Object.fromEntries(RECIPIENT_FIELDS.map((key) => [key, ''])), ...recipient },
  };
  let node: unknown = scope;
  for (const key of path) {
    if (!isRecord(node)) return [];
    node = node[key];
  }
  return isRecord(node) ? Object.keys(node).sort() : [];
};

/**
 * The dotted reference being typed inside an open `{{ }}` or `{% %}` tag, or null
 * where a variable can't go: outside a tag, on a `{% %}` tag's name, after a `|` filter.
 */
export const liquidReference = (before: string): { path: string[]; prefix: string } | null => {
  const open = Math.max(before.lastIndexOf('{{'), before.lastIndexOf('{%'));
  if (open < 0) return null;
  const inside = before.slice(open + 2);
  if (inside.includes('}}') || inside.includes('%}')) return null;
  const reference = /(?:[A-Za-z_]\w*\.)*\w*$/.exec(inside)?.[0] ?? '';
  const head = inside
    .slice(0, inside.length - reference.length)
    .replace(/^-/, '')
    .trim();
  if (head.endsWith('|')) return null;
  if (before.startsWith('{%', open) && head === '') return null;
  const segments = reference.split('.');
  const prefix = segments.pop() ?? '';
  return { path: segments, prefix };
};

/** Chaski's own filters, the ones the server formats with, as the editor offers them. */
export const LIQUID_FILTERS = LOCALE_FILTERS.map(({ name, usage }) => ({ name, usage }));

/** The filter name being typed after a `|` inside an open tag, or null anywhere else. */
export const liquidFilterPrefix = (before: string): string | null => {
  const open = Math.max(before.lastIndexOf('{{'), before.lastIndexOf('{%'));
  if (open < 0) return null;
  const inside = before.slice(open + 2);
  if (inside.includes('}}') || inside.includes('%}')) return null;
  return /\|\s*(\w*)$/.exec(inside)?.[1] ?? null;
};
