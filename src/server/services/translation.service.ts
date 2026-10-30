import { and, eq, inArray } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { languageOf, type TranslationStatus } from '../../contract/locales';
import { type templateChannels, templateTranslations } from '../db/schema';
import { publishAdminEvents } from '../lib/admin-events';
import { sourceHash } from '../lib/fingerprint';
import { assertTemplates, type ChannelFields } from '../lib/render';
import { BaseService } from './base.service';

/** Omitted keeps the saved field, null clears it; a translation can't be left without a body. */
export type TranslationInput = {
  subject?: string | null;
  body?: string;
  textBody?: string | null;
};

/** A channel's content as a contact gets it, and the language it's in. */
export type ResolvedContent = ChannelFields & {
  /** A translation's locale, or the default language; null while the Worker has no languages. */
  locale: string | null;
};

type ChannelRow = typeof templateChannels.$inferSelect;
type TranslationRow = typeof templateTranslations.$inferSelect;

const statusOf = (row: TranslationRow, currentHash: string) =>
  row.sourceHash === currentHash ? ('complete' as const) : ('outdated' as const);

const present = (
  row: TranslationRow,
  channel: ChannelRow,
  currentHash: string,
  supported: string[],
) => ({
  channel: channel.channel as Channel,
  locale: row.locale,
  subject: row.subject,
  body: row.body,
  textBody: row.textBody,
  status: statusOf(row, currentHash),
  // A language taken off the Worker keeps its translations, unused until it comes back.
  supported: supported.includes(row.locale),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// The locales that can serve a contact asking for `requested`, closest first: the exact tag, then
// its language. Only the Worker's other languages take part; anything else gets the default.
const candidatesFor = (requested: string | null, supported: string[]): string[] =>
  requested
    ? [...new Set([requested, languageOf(requested)])].filter((locale) =>
        supported.includes(locale),
      )
    : [];

/** A template channel's content in the Worker's other languages, each written from its default. */
export class TranslationService extends BaseService {
  protected static override name = 'translations';

  /**
   * The content a contact asking for `requested` gets on this channel: the translation in that
   * locale, else in its language, else the default content. Each channel resolves on its own.
   */
  static resolve = async (
    row: ChannelRow & { body: string },
    requested: string | null,
  ): Promise<ResolvedContent> => {
    const locales = TranslationService.config.locales;
    const candidates = candidatesFor(requested, locales?.supported ?? []);
    const translations =
      candidates.length > 0
        ? await TranslationService.client.templateTranslations.findMany({
            where: { templateChannelId: row.id, locale: { in: candidates } },
          })
        : [];
    const translation = candidates
      .map((locale) => translations.find((t) => t.locale === locale))
      .find((t) => t !== undefined);
    const content = translation ?? row;
    return {
      subject: content.subject,
      body: content.body,
      textBody: content.textBody,
      locale: translation?.locale ?? locales?.default ?? null,
    };
  };

  /**
   * Each channel's status in every supported language, for the templates list, and when its
   * latest translation was saved.
   */
  static statuses = async (channels: ChannelRow[]) => {
    const supported = TranslationService.config.locales?.supported ?? [];
    // By locale rather than by channel, which would bind a parameter per channel.
    const translations =
      supported.length > 0
        ? await TranslationService.client.templateTranslations.findMany({
            where: { locale: { in: supported } },
          })
        : [];
    return new Map(
      await Promise.all(
        channels.map(async (channel) => {
          const own = translations.filter((t) => t.templateChannelId === channel.id);
          const currentHash = own.length > 0 ? await sourceHash(channel) : '';
          const statuses: Record<string, TranslationStatus> = Object.fromEntries(
            supported.map((locale) => {
              const row = own.find((t) => t.locale === locale);
              return [locale, row ? statusOf(row, currentHash) : 'missing'];
            }),
          );
          const updatedAt = Math.max(
            channel.updatedAt.getTime(),
            ...own.map((t) => t.updatedAt.getTime()),
          );
          return [channel.id, { statuses, updatedAt }] as const;
        }),
      ),
    );
  };

  /** Every translation of these channels, in any language, as the template detail shows them. */
  static ofChannels = async (channels: ChannelRow[]) => {
    const supported = TranslationService.config.locales?.supported ?? [];
    const translations =
      channels.length > 0
        ? await TranslationService.client.templateTranslations.findMany({
            where: { templateChannelId: { in: channels.map((c) => c.id) } },
            orderBy: [{ locale: 'asc' }],
          })
        : [];
    return new Map(
      await Promise.all(
        channels.map(async (channel) => {
          const own = translations.filter((t) => t.templateChannelId === channel.id);
          const currentHash = own.length > 0 ? await sourceHash(channel) : '';
          return [channel.id, own.map((t) => present(t, channel, currentHash, supported))] as const;
        }),
      ),
    );
  };

  private static channelRow = async (templateId: string, channel: Channel) => {
    const client = TranslationService.client;
    if (!(await client.templates.findFirst({ where: { id: templateId } }))) {
      throw new ChaskiError('not_found', `template '${templateId}' not found`);
    }
    const row = await client.templateChannels.findFirst({ where: { templateId, channel } });
    if (!row) {
      throw new ChaskiError('not_found', `the template has no ${channel} content to translate`);
    }
    return row;
  };

  private static load = async (row: ChannelRow, locale: string) => {
    const translation = await TranslationService.client.templateTranslations.findFirst({
      where: { templateChannelId: row.id, locale },
    });
    if (!translation) {
      throw new ChaskiError('not_found', `the ${row.channel} content has no ${locale} translation`);
    }
    return present(
      translation,
      row,
      await sourceHash(row),
      TranslationService.config.locales?.supported ?? [],
    );
  };

  static get = async (templateId: string, channel: Channel, locale: string) =>
    TranslationService.load(await TranslationService.channelRow(templateId, channel), locale);

  /** Saves a translation from the channel's current default content, which makes it current. */
  static save = async (
    templateId: string,
    channel: Channel,
    locale: string,
    input: TranslationInput,
  ) => {
    const locales = TranslationService.config.locales;
    if (!locales) {
      throw new ChaskiError(
        'validation',
        'this Chaski has no languages yet: save them on the Channels page first',
      );
    }
    if (locale === locales.default) {
      throw new ChaskiError(
        'validation',
        `${locale} is the default language: edit the channel's own content instead`,
      );
    }
    if (!locales.supported.includes(locale)) {
      throw new ChaskiError(
        'validation',
        `${locale} isn't one of this Chaski's languages: add it on the Channels page first`,
      );
    }
    assertTemplates({ subject: input.subject, body: input.body, textBody: input.textBody });
    const row = await TranslationService.channelRow(templateId, channel);
    const existing = await TranslationService.client.templateTranslations.findFirst({
      where: { templateChannelId: row.id, locale },
    });
    const body = input.body ?? existing?.body;
    if (!body?.trim()) throw new ChaskiError('validation', 'body: a translation needs a body');
    await TranslationService.client.templateTranslations.upsertMany({
      data: [
        {
          templateChannelId: row.id,
          locale,
          subject: input.subject === undefined ? (existing?.subject ?? null) : input.subject,
          body,
          textBody: input.textBody === undefined ? (existing?.textBody ?? null) : input.textBody,
          sourceHash: await sourceHash(row),
        },
      ],
      target: ['templateChannelId', 'locale'],
      update: ['subject', 'body', 'textBody', 'sourceHash', 'updatedAt'],
    });
    await publishAdminEvents(['templates', 'locales']);
    return TranslationService.load(row, locale);
  };

  /** Takes the translation as written from the channel's current content, without changing it. */
  static markCurrent = async (templateId: string, channel: Channel, locale: string) => {
    const row = await TranslationService.channelRow(templateId, channel);
    await TranslationService.load(row, locale);
    await TranslationService.client.templateTranslations.update({
      where: { templateChannelId: row.id, locale },
      data: { sourceHash: await sourceHash(row) },
    });
    await publishAdminEvents(['templates']);
    return TranslationService.load(row, locale);
  };

  static delete = async (templateId: string, channel: Channel, locale: string): Promise<void> => {
    const row = await TranslationService.channelRow(templateId, channel);
    const result = await TranslationService.db
      .delete(templateTranslations)
      .where(
        and(
          eq(templateTranslations.templateChannelId, row.id),
          eq(templateTranslations.locale, locale),
        ),
      );
    if (result.meta.changes === 0) {
      throw new ChaskiError('not_found', `the ${channel} content has no ${locale} translation`);
    }
    await publishAdminEvents(['templates', 'locales']);
  };

  /** Takes a language off a template: its translation on every channel. Returns how many. */
  static deleteLanguage = async (templateId: string, locale: string): Promise<number> => {
    const client = TranslationService.client;
    if (!(await client.templates.findFirst({ where: { id: templateId } }))) {
      throw new ChaskiError('not_found', `template '${templateId}' not found`);
    }
    const channels = await client.templateChannels.findMany({ where: { templateId } });
    const removed = await TranslationService.db.delete(templateTranslations).where(
      and(
        eq(templateTranslations.locale, locale),
        inArray(
          templateTranslations.templateChannelId,
          channels.map((channel) => channel.id),
        ),
      ),
    );
    if (removed.meta.changes === 0) {
      throw new ChaskiError('not_found', `the template has no ${locale} translation`);
    }
    await publishAdminEvents(['templates', 'locales']);
    return removed.meta.changes;
  };
}
