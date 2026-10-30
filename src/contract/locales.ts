import { z } from 'zod';

/**
 * A BCP 47 tag in its canonical form (`es-pe` → `es-PE`; `pt_BR`, as POSIX and Java write it,
 * reads as `pt-BR`), or null for anything Intl can't read: such a locale counts as absent.
 */
export const canonicalLocale = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    return Intl.getCanonicalLocales(value.trim().replaceAll('_', '-'))[0] ?? null;
  } catch {
    return null;
  }
};

/** The language a tag names, without its script or region: `es` for `es-PE`. */
export const languageOf = (locale: string): string => new Intl.Locale(locale).language;

/** A locale someone writes on purpose, such as a language of the Worker: refused unless valid. */
export const localeSchema = z
  .string()
  .max(35)
  .transform((value, ctx) => {
    const locale = canonicalLocale(value);
    if (locale) return locale;
    ctx.addIssue({ code: 'custom', message: `'${value}' is not a BCP 47 language tag` });
    return z.NEVER;
  });

/** The languages a Chaski sends in: the default, which every template starts in, and the rest. */
export type Locales = { default: string; supported: string[] };

/**
 * How a translation stands against the default content of its channel: `outdated` once the
 * default content changed after the translation was saved, `missing` when there is none.
 */
export type TranslationStatus = 'complete' | 'outdated' | 'missing';
