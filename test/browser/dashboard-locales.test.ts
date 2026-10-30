import { describe, expect, it } from 'vitest';
import { formatDay } from '../../src/dashboard/lib/format';
import {
  coverageNote,
  isFallback,
  languageChoices,
  languageCoverage,
  languageName,
  languageNote,
  languageStatus,
  languagesOf,
  listOf,
  templateLanguages,
} from '../../src/dashboard/lib/locales';
import type {
  Channel,
  LocalesSettings,
  TemplateChannelContent,
  TemplateSummary,
  TranslationStatus,
} from '../../src/dashboard/lib/types';

const settings = (overrides: Partial<LocalesSettings>): LocalesSettings => ({
  default: 'en',
  supported: [],
  translations: 0,
  updatedBy: null,
  updatedAt: null,
  problem: null,
  ...overrides,
});

const summary = (
  type: string,
  channels: Array<[Channel, boolean, Record<string, TranslationStatus>]>,
): TemplateSummary => ({
  id: `tpl_${type}`,
  type,
  description: null,
  topic: null,
  updatedAt: '2026-10-28T10:00:00Z',
  contentUpdatedAt: '2026-10-28T10:00:00Z',
  lastUsedAt: null,
  channels: channels.map(([channel, enabled, translations]) => ({
    channel,
    enabled,
    translations,
  })),
});

const content = (
  channel: Channel,
  enabled: boolean,
  translations: Array<[string, 'complete' | 'outdated']>,
): TemplateChannelContent => ({
  id: `tc_${channel}`,
  channel,
  enabled,
  subject: null,
  body: 'Body',
  textBody: null,
  updatedAt: '2026-10-28T10:00:00Z',
  translations: translations.map(([locale, status]) => ({
    channel,
    locale,
    subject: null,
    body: 'Cuerpo',
    textBody: null,
    status,
    supported: true,
    createdAt: '2026-10-12T10:00:00Z',
    updatedAt: '2026-10-12T10:00:00Z',
  })),
});

describe('dashboard languages', () => {
  it('shows languages only once the Worker has one besides the default', () => {
    expect(languagesOf(undefined)).toBeNull();
    expect(languagesOf(settings({ default: null }))).toBeNull();
    expect(languagesOf(settings({ supported: [] }))).toBeNull();
    expect(languagesOf(settings({ supported: ['es'] }))).toEqual({
      default: 'en',
      supported: ['es'],
    });
  });

  it('names languages in English, with the region in brackets', () => {
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('pt-BR')).toBe('Portuguese (Brazil)');
    expect(languageName('not a tag')).toBe('not a tag');
  });

  it('offers the languages not taken yet, by name', () => {
    const choices = languageChoices(['en', 'es']).map((choice) => choice.locale);
    expect(choices).not.toContain('en');
    expect(choices).not.toContain('es');
    expect(choices).toContain('es-MX');
    const names = languageChoices([]).map((choice) => choice.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('counts a regional match as the language asked for, not a fallback', () => {
    expect(isFallback('es-PE', 'es')).toBe(false);
    expect(isFallback('es-PE', 'en')).toBe(true);
    expect(isFallback('fr', 'en')).toBe(true);
    expect(isFallback(null, 'en')).toBe(false);
    expect(isFallback('fr', null)).toBe(false);
  });

  it('says where a delivery’s language came from and why the default went out', () => {
    const delivery = {
      channel: 'in_app' as const,
      requestedLocale: 'es-PE',
      requestedLocaleFrom: 'contact' as const,
      renderedLocale: 'en',
    };
    expect(languageNote(delivery)).toBe(
      'Asked for es-PE, from the contact. No in-app content in es-PE or es, so the default went out.',
    );
    expect(languageNote({ ...delivery, requestedLocale: 'fr' })).toBe(
      'Asked for fr, from the contact. No in-app content in fr, so the default went out.',
    );
    expect(
      languageNote({
        ...delivery,
        requestedLocale: 'es',
        requestedLocaleFrom: 'send',
        renderedLocale: 'es',
      }),
    ).toBe('Asked for es, from the send.');
    expect(languageNote({ ...delivery, requestedLocale: null, requestedLocaleFrom: null })).toBe(
      'No language asked for, so the default went out.',
    );
    expect(languageNote({ ...delivery, requestedLocale: 'fr', renderedLocale: null })).toBe(
      'Asked for fr, from the contact.',
    );
    expect(
      languageNote({
        ...delivery,
        requestedLocale: null,
        requestedLocaleFrom: null,
        renderedLocale: null,
      }),
    ).toBeNull();
  });
});

describe('dashboard translation status', () => {
  it('lists a template’s languages over the channels that send', () => {
    const channels = summary('payment_received', [
      ['email', true, { es: 'outdated', 'pt-BR': 'complete', fr: 'missing' }],
      ['in_app', true, { es: 'missing', 'pt-BR': 'complete', fr: 'missing' }],
      ['push', false, { es: 'missing', 'pt-BR': 'missing', fr: 'missing' }],
    ]).channels;
    expect(templateLanguages(channels, ['es', 'pt-BR', 'fr'])).toEqual({
      complete: ['pt-BR'],
      missing: ['es', 'fr'],
      outdated: ['es'],
    });
  });

  it('counts every channel of a template with none sending', () => {
    const channels = summary('draft', [['email', false, { es: 'missing' }]]).channels;
    expect(templateLanguages(channels, ['es']).missing).toEqual(['es']);
  });

  it('says how far the templates have a language', () => {
    const templates = [
      summary('invoice_due', [
        ['email', true, { es: 'complete', 'pt-BR': 'missing', fr: 'missing' }],
      ]),
      summary('payment_received', [
        ['email', true, { es: 'outdated', 'pt-BR': 'complete', fr: 'missing' }],
        ['in_app', true, { es: 'missing', 'pt-BR': 'complete', fr: 'missing' }],
      ]),
      summary('welcome', [['email', true, { es: 'complete', 'pt-BR': 'complete', fr: 'missing' }]]),
    ];

    const spanish = languageCoverage(templates, 'es');
    expect(spanish).toMatchObject({ total: 3, translated: 3, outdated: 1, missing: 1 });
    expect(coverageNote(spanish)).toBe('1 outdated, 1 channel missing');

    const portuguese = languageCoverage(templates, 'pt-BR');
    expect(portuguese).toMatchObject({ translated: 2, without: ['invoice_due'] });
    expect(coverageNote(portuguese)).toBe('invoice_due missing');

    const french = languageCoverage(templates, 'fr');
    expect(french.translated).toBe(0);
    expect(coverageNote(french)).toBeNull();
  });

  it('names how many templates lack a language once more than one does', () => {
    const templates = [
      summary('a', [['email', true, { es: 'complete' }]]),
      summary('b', [['email', true, { es: 'missing' }]]),
      summary('c', [['email', true, { es: 'missing' }]]),
    ];
    expect(coverageNote(languageCoverage(templates, 'es'))).toBe('2 templates missing');
  });

  it('sums up a language in the editor’s menu over the channels that send', () => {
    const channels = [
      content('email', true, [['es', 'outdated']]),
      content('in_app', true, []),
      content('push', false, []),
    ];
    expect(languageStatus(channels, 'es')).toEqual({
      note: '1 outdated · 1 missing',
      attention: true,
    });
    expect(
      languageStatus(
        [content('email', true, [['pt-BR', 'complete']]), content('push', false, [])],
        'pt-BR',
      ),
    ).toEqual({ note: 'Up to date', attention: false });
  });

  it('lists what a removal deletes as a sentence does', () => {
    expect(listOf(['email'])).toBe('email');
    expect(listOf(['email', 'in-app item'])).toBe('email and in-app item');
    expect(listOf(['email', 'in-app item', 'push notification'])).toBe(
      'email, in-app item, and push notification',
    );
  });

  it('dates a save by month and day', () => {
    expect(formatDay('2026-10-28T12:00:00Z')).toBe('Oct 28');
  });
});
