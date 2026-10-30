import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type {
  Channel,
  LocalesSettings,
  TemplateChannelContent,
  TemplateSummary,
  TranslationStatus,
} from './types';

export const useLocales = () =>
  useQuery({
    queryKey: ['locales'],
    queryFn: async () => (await api.get<{ locales: LocalesSettings }>('settings/locales')).locales,
  });

/** What the Worker's content is in until languages are saved, as the server formats it. */
export const IMPLICIT_DEFAULT = 'en';

/**
 * The Worker's languages once it has one besides the default. Until then every screen shows
 * a single language, as before languages existed.
 */
export const languagesOf = (settings: LocalesSettings | undefined) =>
  settings?.default && settings.supported.length > 0
    ? { default: settings.default, supported: settings.supported }
    : null;

const names = new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' });

/** `Spanish` for es, `Portuguese (Brazil)` for pt-BR; the tag itself when Intl can't name it. */
export const languageName = (locale: string) => {
  try {
    return names.of(locale) ?? locale;
  } catch {
    return locale;
  }
};

/** The language a tag names, without its region: `es` for es-PE. */
const languageOf = (locale: string) => {
  try {
    return new Intl.Locale(locale).language;
  } catch {
    return locale;
  }
};

/**
 * Whether a delivery went out in another language than the one asked for. A regional match
 * (es for es-PE) is the language asked for, as the overview counts it.
 */
export const isFallback = (requested: string | null, rendered: string | null) =>
  requested !== null && rendered !== null && languageOf(requested) !== languageOf(rendered);

// The languages the pickers offer: Intl names any tag but can't list them.
const PICKER_LOCALES = [
  'af am ar az be bg bn bs ca cs cy da de de-AT de-CH el en en-AU en-CA en-GB en-US es es-419',
  'es-AR es-CO es-ES es-MX es-PE et eu fa fi fil fr fr-BE fr-CA fr-CH ga gl gu he hi hr hu hy',
  'id is it ja ka kk km kn ko lo lt lv mk ml mn mr ms mt my nb ne nl nl-BE pa pl pt pt-BR pt-PT',
  'qu ro ru si sk sl sq sr sv sw ta te th tr uk ur uz vi zh zh-Hans zh-Hant zu',
]
  .join(' ')
  .split(' ');

/** The languages a picker offers, by name, without the ones already taken. */
export const languageChoices = (taken: string[]) =>
  PICKER_LOCALES.filter((locale) => !taken.includes(locale))
    .map((locale) => ({ locale, name: languageName(locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

// A channel that sends is what a contact gets; a template with none sending counts them all.
const sending = <T extends { enabled: boolean }>(channels: T[]) => {
  const live = channels.filter((channel) => channel.enabled);
  return live.length > 0 ? live : channels;
};

/** A template's languages for the list: complete everywhere, missing or outdated somewhere. */
export const templateLanguages = (channels: TemplateSummary['channels'], supported: string[]) => {
  const counted = sending(channels);
  const summary = { complete: [] as string[], missing: [] as string[], outdated: [] as string[] };
  for (const locale of supported) {
    const statuses = counted.map((channel) => channel.translations[locale] ?? 'missing');
    if (statuses.includes('missing')) summary.missing.push(locale);
    if (statuses.includes('outdated')) summary.outdated.push(locale);
    if (statuses.every((status) => status === 'complete')) summary.complete.push(locale);
  }
  return summary;
};

/**
 * How far the templates have a language, for the Channels page: how many have it on some
 * channel, which have none, and how many of their sending channels are outdated or missing.
 */
export const languageCoverage = (templates: TemplateSummary[], locale: string) => {
  const coverage = { total: templates.length, translated: 0, without: [] as string[] };
  let outdated = 0;
  let missing = 0;
  for (const template of templates) {
    const has = template.channels.some((c) => (c.translations[locale] ?? 'missing') !== 'missing');
    if (!has) {
      coverage.without.push(template.type);
      continue;
    }
    coverage.translated += 1;
    for (const channel of sending(template.channels)) {
      const status = channel.translations[locale] ?? 'missing';
      if (status === 'outdated') outdated += 1;
      if (status === 'missing') missing += 1;
    }
  }
  return { ...coverage, outdated, missing };
};

/** `1 outdated, 1 channel missing` or `invoice_due missing`; null when nothing needs saying. */
export const coverageNote = (coverage: ReturnType<typeof languageCoverage>) => {
  const parts: string[] = [];
  const { without, translated } = coverage;
  if (translated > 0 && without.length === 1) parts.push(`${without[0]} missing`);
  if (translated > 0 && without.length > 1) parts.push(`${without.length} templates missing`);
  if (coverage.outdated > 0) parts.push(`${coverage.outdated} outdated`);
  if (coverage.missing > 0) {
    parts.push(`${coverage.missing} ${coverage.missing === 1 ? 'channel' : 'channels'} missing`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
};

/** A template channel's translation status in a language. */
export const statusIn = (channel: TemplateChannelContent, locale: string): TranslationStatus =>
  channel.translations.find((t) => t.locale === locale)?.status ?? 'missing';

/** Whether a channel sends: on, with a body. Only those count toward a language's status. */
export const channelSends = (channel: TemplateChannelContent) =>
  channel.enabled && Boolean(channel.body?.trim());

/** `1 outdated · 1 missing` over the channels that send, or `Up to date`. */
export const languageStatus = (channels: TemplateChannelContent[], locale: string) => {
  const statuses = channels.filter(channelSends).map((channel) => statusIn(channel, locale));
  const outdated = statuses.filter((status) => status === 'outdated').length;
  const missing = statuses.filter((status) => status === 'missing').length;
  const parts = [
    outdated > 0 ? `${outdated} outdated` : null,
    missing > 0 ? `${missing} missing` : null,
  ].filter((part) => part !== null);
  return { note: parts.length > 0 ? parts.join(' · ') : 'Up to date', attention: parts.length > 0 };
};

/** What one channel's content is, in a sentence: `the English email`, `the in-app item`. */
export const CONTENT_NOUNS: Record<Channel, string> = {
  email: 'email',
  in_app: 'in-app item',
  push: 'push notification',
};

// Channels as a sentence names them: `No in-app content in fr`.
const CHANNEL_WORDS: Record<Channel, string> = { email: 'email', in_app: 'in-app', push: 'push' };

const list = new Intl.ListFormat('en', { type: 'conjunction' });

export const listOf = (items: string[]) => list.format(items);

/**
 * Where a delivery's language came from, in a sentence: what was asked for and by whom, and
 * why the default went out instead. Null when nothing was asked for and nothing rendered.
 */
export const languageNote = (delivery: {
  channel: Channel;
  requestedLocale: string | null;
  requestedLocaleFrom: 'send' | 'contact' | null;
  renderedLocale: string | null;
}) => {
  const { requestedLocale: requested, renderedLocale: rendered } = delivery;
  if (!requested) return rendered ? 'No language asked for, so the default went out.' : null;
  const asked = `Asked for ${requested}, from the ${delivery.requestedLocaleFrom ?? 'send'}.`;
  if (!isFallback(requested, rendered)) return asked;
  const language = languageOf(requested);
  const tried = language === requested ? requested : `${requested} or ${language}`;
  const channel = CHANNEL_WORDS[delivery.channel];
  return `${asked} No ${channel} content in ${tried}, so the default went out.`;
};
