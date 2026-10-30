import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import {
  TEMPLATE_FILE_FORMAT,
  TEMPLATE_FILE_VERSION,
  type TemplateChange,
  type TemplateFile,
  type TemplateImportResult,
  type TemplateRecord,
  type TemplateTranslation,
  templateFileSchema,
  templateWarnings,
} from '../../contract/template-file';
import {
  notifications,
  type templateChannels,
  templates,
  type templateTranslations,
} from '../db/schema';
import { publishAdminEvents } from '../lib/admin-events';
import { DeliveryError } from '../lib/errors';
import { OUTDATED_HASH, sourceHash } from '../lib/fingerprint';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { assertTemplates, localeFormat, renderFields } from '../lib/render';
import { parseInput } from '../lib/validate';
import type { NotificationRow } from './adapters/types';
import { BaseService } from './base.service';
import type { ContactSnapshot } from './contact.service';
import { EmailSenderService, senderAddress } from './email-sender.service';
import { type ResolvedContent, TranslationService } from './translation.service';

export type ChannelContentInput = {
  enabled?: boolean;
  subject?: string | null;
  body?: string | null;
  textBody?: string | null;
};

export type RenderedPreview = {
  subject: string;
  html: string;
  text?: string;
  /** The language the content rendered in; null while the Worker has no languages. */
  locale: string | null;
};

export type ActiveChannelContent = ResolvedContent & { templateId: string };

type ChannelRow = typeof templateChannels.$inferSelect;
type TranslationRow = typeof templateTranslations.$inferSelect;

// A channel only renders in production when it is enabled AND has a body;
// toggling a channel off (or leaving it unconfigured) skips it at dispatch.
const isLive = (row: {
  enabled: boolean;
  body: string | null;
}): row is typeof row & {
  body: string;
} => row.enabled && Boolean(row.body?.trim());

const TEMPLATE_FIELDS = ['description', 'topic', 'sampleData'] as const;
const CHANNEL_FIELDS = ['enabled', 'subject', 'body', 'textBody'] as const;
const TRANSLATION_FIELDS = ['subject', 'body', 'textBody'] as const;

type ImportedTranslation = {
  channel: Channel;
  locale: string;
  translation: TemplateTranslation;
  sourceHash: string;
};

type ImportPlan = { change: TemplateChange; translations: ImportedTranslation[] };

const translationKey = (type: string, channel: string, locale: string) =>
  `${type}\u0000${channel}\u0000${locale}`;

// Compares the way the import writes: an absent field stores null, and a channel or a
// translation the file leaves out keeps whatever it has. A translation's outdated flag compares
// against the default content the file brings, which is the channel's once it's imported.
const planImport = async (
  existing: TemplateRecord | undefined,
  incoming: TemplateRecord,
  stored: Map<string, TranslationRow>,
): Promise<ImportPlan> => {
  const warnings = templateWarnings(incoming);
  const fields: string[] = existing
    ? TEMPLATE_FIELDS.filter((field) => (existing[field] ?? null) !== (incoming[field] ?? null))
    : [];
  const translations: ImportedTranslation[] = [];
  for (const content of incoming.channels ?? []) {
    const storedChannel = existing?.channels?.find((c) => c.channel === content.channel);
    if (existing && !storedChannel) fields.push(`channels.${content.channel}`);
    if (storedChannel) {
      for (const field of CHANNEL_FIELDS) {
        if ((storedChannel[field] ?? null) !== (content[field] ?? null)) {
          fields.push(`channels.${content.channel}.${field}`);
        }
      }
    }
    const entries = Object.entries(content.translations ?? {});
    const currentHash = entries.length > 0 ? await sourceHash(content) : OUTDATED_HASH;
    for (const [locale, translation] of entries) {
      const outdated = translation.outdated ?? false;
      const next = {
        channel: content.channel,
        locale,
        translation,
        sourceHash: outdated ? OUTDATED_HASH : currentHash,
      };
      const row = storedChannel
        ? stored.get(translationKey(incoming.type, content.channel, locale))
        : undefined;
      if (!row) {
        if (storedChannel) fields.push(`channels.${content.channel}.translations.${locale}`);
        translations.push(next);
        continue;
      }
      const at = `channels.${content.channel}.translations.${locale}`;
      const changed: string[] = TRANSLATION_FIELDS.filter(
        (field) => (row[field] ?? null) !== (translation[field] ?? null),
      ).map((field) => `${at}.${field}`);
      if ((row.sourceHash !== currentHash) !== outdated) changed.push(`${at}.outdated`);
      if (changed.length > 0) {
        fields.push(...changed);
        translations.push(next);
      }
    }
  }
  const change: TemplateChange['change'] = !existing
    ? 'create'
    : fields.length > 0
      ? 'update'
      : 'unchanged';
  return { change: { type: incoming.type, change, fields, warnings }, translations };
};

export class TemplateService extends BaseService {
  protected static override name = 'templates';

  static hasType = async (type: string): Promise<boolean> => {
    const row = await TemplateService.client.templates.findFirst({ where: { type } });
    return Boolean(row);
  };

  /** Templates not in the trash: one per type a send can name. */
  static countLive = (): Promise<number> => TemplateService.client.templates.count({ where: {} });

  // Preference-UI helper: template types grouped by their dashboard-assigned
  // topic. Groups sort alphabetically with the topicless group last; types are
  // sorted within each group.
  static topics = async (): Promise<Array<{ topic: string | null; types: string[] }>> => {
    const rows = await TemplateService.client.templates.findMany({ orderBy: [{ type: 'asc' }] });
    const groups = new Map<string | null, string[]>();
    for (const row of rows) {
      const topic = row.topic ?? null;
      const types = groups.get(topic);
      if (types) types.push(row.type);
      else groups.set(topic, [row.type]);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
      .map(([topic, types]) => ({ topic, types }));
  };

  static findActiveContent = async (
    type: string,
    channel: Channel,
    requested: string | null = null,
  ): Promise<ActiveChannelContent | null> => {
    const template = await TemplateService.client.templates.findFirst({ where: { type } });
    if (!template) return null;
    const row = await TemplateService.client.templateChannels.findFirst({
      where: { templateId: template.id, channel },
    });
    if (!row || !isLive(row)) return null;
    return { templateId: template.id, ...(await TranslationService.resolve(row, requested)) };
  };

  /**
   * Renders a delivery's content with the send's payload, `recipient` and, once the Worker has
   * languages, the `locale` it renders in, which then wins over a payload key of that name.
   */
  static renderDelivery = (
    content: ResolvedContent,
    notification: NotificationRow,
    options: { html: boolean },
  ) => {
    const snapshot = parseJson<ContactSnapshot>(notification.contactSnapshot, {});
    const data = {
      ...parseJson<Record<string, unknown>>(notification.payload, {}),
      recipient: snapshot,
      ...(content.locale ? { locale: content.locale } : {}),
    };
    return renderFields(content, data, {
      html: options.html,
      format: localeFormat(content.locale, notification.requestedLocale, snapshot.timezone),
    });
  };

  static activeChannelFlags = async (
    type: string,
    channels: Channel[],
  ): Promise<Partial<Record<Channel, boolean>>> => {
    const flags: Partial<Record<Channel, boolean>> = {};
    const template = await TemplateService.client.templates.findFirst({ where: { type } });
    if (!template) return flags;
    const rows = await TemplateService.client.templateChannels.findMany({
      where: { templateId: template.id },
    });
    for (const row of rows) {
      if (isLive(row) && channels.includes(row.channel as Channel)) {
        flags[row.channel as Channel] = true;
      }
    }
    return flags;
  };

  static list = async () => {
    const rows = await TemplateService.client.templates.findMany({ orderBy: [{ type: 'asc' }] });
    if (rows.length === 0) return [];
    const [channels, lastUsedRows] = await Promise.all([
      TemplateService.client.templateChannels.findMany({
        where: { templateId: { in: rows.map((row) => row.id) } },
        orderBy: [{ channel: 'asc' }],
      }),
      TemplateService.db
        .select({
          type: notifications.type,
          lastUsedAt: sql<number | null>`max(${notifications.createdAt})`,
        })
        .from(notifications)
        .groupBy(notifications.type)
        .all(),
    ]);
    const languages = await TranslationService.statuses(channels);
    const lastUsedByType = new Map(lastUsedRows.map((row) => [row.type, row.lastUsedAt]));
    return rows.map((row) => {
      const own = channels.filter((c) => c.templateId === row.id);
      return {
        ...row,
        // Editing a channel's content, or a translation, stamps only that row, so the template
        // was last edited at the latest of them.
        contentUpdatedAt: new Date(
          Math.max(
            row.updatedAt.getTime(),
            ...own.map((c) => languages.get(c.id)?.updatedAt ?? c.updatedAt.getTime()),
          ),
        ).toISOString(),
        lastUsedAt:
          lastUsedByType.get(row.type) == null
            ? null
            : new Date(lastUsedByType.get(row.type) as number).toISOString(),
        channels: own.map((c) => ({
          channel: c.channel,
          enabled: isLive(c),
          translations: languages.get(c.id)?.statuses ?? {},
        })),
      };
    });
  };

  // Audit/recovery path. Ordinary reads remain active-only through the
  // soft-delete plugin; callers must opt in explicitly to see tombstones.
  static listDeleted = async () =>
    TemplateService.client.templates.findMany({
      deleted: 'only',
      orderBy: [{ deletedAt: 'desc' }, { type: 'asc' }],
    });

  /** Brings a deleted template back, unless another live template took its type. */
  static restoreTemplate = async (templateId: string) => {
    const client = TemplateService.client;
    const deleted = await client.templates.findFirst({
      where: { id: templateId },
      deleted: 'only',
    });
    if (!deleted) throw new ChaskiError('not_found', `deleted template '${templateId}' not found`);
    if (await client.templates.findFirst({ where: { type: deleted.type } })) {
      throw new ChaskiError(
        'conflict',
        `a live template already has type '${deleted.type}'; delete or rename it first`,
      );
    }
    // A conditional write: two restores at once bring the template back once.
    await TemplateService.db
      .update(templates)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(templates.id, templateId), isNotNull(templates.deletedAt)));
    await publishAdminEvents(['templates']);
    return TemplateService.get(templateId);
  };

  static createTemplate = async (input: {
    type: string;
    description?: string | null;
    topic?: string | null;
    channels?: Channel[];
  }) => {
    const created = await TemplateService.client.templates.create({
      data: {
        id: newId('tpl'),
        type: input.type,
        description: input.description ?? null,
        topic: input.topic ?? null,
      },
      skipDuplicates: true,
    });
    if (!created) {
      throw new ChaskiError('conflict', `template for type '${input.type}' already exists`);
    }
    for (const channel of input.channels ?? []) {
      await TemplateService.client.templateChannels.create({
        data: { id: newId('tc'), templateId: created.id, channel, enabled: true },
        skipDuplicates: true,
      });
    }
    await publishAdminEvents(['templates']);
    return created;
  };

  /** Every live template with its channel content and translations, as the template file has it. */
  static exportTemplates = async (): Promise<TemplateRecord[]> => {
    const client = TemplateService.client;
    const [rows, channels, translations] = await Promise.all([
      client.templates.findMany({ orderBy: [{ type: 'asc' }] }),
      client.templateChannels.findMany({ orderBy: [{ channel: 'asc' }] }),
      client.templateTranslations.findMany({ orderBy: [{ locale: 'asc' }] }),
    ]);
    const content = async (channel: ChannelRow) => {
      const own = translations.filter((t) => t.templateChannelId === channel.id);
      const currentHash = own.length > 0 ? await sourceHash(channel) : OUTDATED_HASH;
      return {
        channel: channel.channel as Channel,
        enabled: channel.enabled,
        subject: channel.subject,
        body: channel.body,
        textBody: channel.textBody,
        ...(own.length > 0
          ? {
              translations: Object.fromEntries(
                own.map((t) => [
                  t.locale,
                  {
                    subject: t.subject,
                    body: t.body,
                    textBody: t.textBody,
                    ...(t.sourceHash === currentHash ? {} : { outdated: true }),
                  },
                ]),
              ),
            }
          : {}),
      };
    };
    return Promise.all(
      rows.map(async (row) => ({
        type: row.type,
        description: row.description,
        topic: row.topic,
        sampleData: row.sampleData,
        channels: await Promise.all(
          channels.filter((channel) => channel.templateId === row.id).map(content),
        ),
      })),
    );
  };

  /** Every live template, as the file `templates().import()` takes. */
  static exportFile = async (): Promise<TemplateFile> => ({
    format: TEMPLATE_FILE_FORMAT,
    version: TEMPLATE_FILE_VERSION,
    defaultLocale: TemplateService.config.locales?.default ?? null,
    templates: await TemplateService.exportTemplates(),
  });

  static importFile = async (
    rawFile: unknown,
    options: { preview?: boolean } = {},
  ): Promise<TemplateImportResult> => {
    const file = parseInput(templateFileSchema, rawFile);
    return TemplateService.importTemplates(file.templates, {
      preview: options.preview ?? false,
      defaultLocale: file.defaultLocale ?? null,
    });
  };

  /**
   * Creates or overwrites templates by type and leaves identical ones alone,
   * so importing the same file twice changes nothing. With `preview` it only
   * reports what it would do.
   */
  static importTemplates = async (
    records: TemplateRecord[],
    options: { preview: boolean; defaultLocale: string | null },
  ): Promise<TemplateImportResult> => {
    for (const record of records) {
      for (const content of record.channels ?? []) {
        const at = `${record.type} ${content.channel}`;
        assertTemplates({
          [`${at} subject`]: content.subject,
          [`${at} body`]: content.body,
          [`${at} textBody`]: content.textBody,
        });
        for (const [locale, translation] of Object.entries(content.translations ?? {})) {
          assertTemplates({
            [`${at} ${locale} subject`]: translation.subject,
            [`${at} ${locale} body`]: translation.body,
            [`${at} ${locale} textBody`]: translation.textBody,
          });
        }
      }
    }
    TemplateService.assertDefaultLocale(records, options.defaultLocale);

    const [exported, stored] = await Promise.all([
      TemplateService.exportTemplates(),
      TemplateService.liveTranslations(),
    ]);
    const current = new Map(exported.map((r) => [r.type, r]));
    const plans = await Promise.all(
      records.map((record) => planImport(current.get(record.type), record, stored)),
    );
    const changes = plans.map((plan) => plan.change);
    if (options.preview) return { applied: false, changes };

    const client = TemplateService.client;
    const changed = records.flatMap((record, index) => {
      const plan = plans[index];
      return plan && plan.change.change !== 'unchanged' ? [{ record, plan }] : [];
    });
    for (const { record, plan } of changed) {
      const fields = {
        description: record.description ?? null,
        topic: record.topic ?? null,
        sampleData: record.sampleData ?? null,
      };
      const existing = await client.templates.findFirst({ where: { type: record.type } });
      const template = existing
        ? await client.templates.update({ where: { id: existing.id }, data: fields })
        : await client.templates.create({
            data: { id: newId('tpl'), type: record.type, ...fields },
          });
      if (!template) throw new ChaskiError('internal', `template '${record.type}' was not stored`);
      for (const content of record.channels ?? []) {
        await client.templateChannels.upsertMany({
          data: [
            {
              id: newId('tc'),
              templateId: template.id,
              channel: content.channel,
              enabled: content.enabled,
              subject: content.subject ?? null,
              body: content.body ?? null,
              textBody: content.textBody ?? null,
            },
          ],
          target: ['templateId', 'channel'],
          update: ['enabled', 'subject', 'body', 'textBody', 'updatedAt'],
        });
      }
      if (plan.translations.length === 0) continue;
      const channelIds = new Map(
        (await client.templateChannels.findMany({ where: { templateId: template.id } })).map(
          (row) => [row.channel, row.id],
        ),
      );
      await client.templateTranslations.upsertMany({
        data: plan.translations.map((t) => ({
          templateChannelId: channelIds.get(t.channel) ?? '',
          locale: t.locale,
          subject: t.translation.subject ?? null,
          body: t.translation.body,
          textBody: t.translation.textBody ?? null,
          sourceHash: t.sourceHash,
        })),
        target: ['templateChannelId', 'locale'],
        update: ['subject', 'body', 'textBody', 'sourceHash', 'updatedAt'],
      });
    }
    if (changed.length > 0) {
      await publishAdminEvents(['templates', 'locales']);
      TemplateService.log.info('templates imported', { changed: changed.length });
    }
    return { applied: true, changes };
  };

  /**
   * A file's default content has to be in the Worker's default language, and its translations
   * need the Worker's languages saved: they'd mean nothing, or the wrong thing, otherwise.
   */
  private static assertDefaultLocale = (records: TemplateRecord[], fileDefault: string | null) => {
    const workerDefault = TemplateService.config.locales?.default ?? null;
    if (fileDefault && workerDefault && fileDefault !== workerDefault) {
      throw new ChaskiError(
        'validation',
        `the file's default content is in ${fileDefault}, and this Chaski's default language is ` +
          `${workerDefault}: export the file again from a Chaski whose default is ${workerDefault}`,
      );
    }
    const translated = records.some((record) =>
      (record.channels ?? []).some((c) => Object.keys(c.translations ?? {}).length > 0),
    );
    if (translated && !workerDefault) {
      throw new ChaskiError(
        'validation',
        `the file has translations, and this Chaski has no languages: save them on the Channels ` +
          `page, with ${fileDefault} as the default, then import it again`,
      );
    }
  };

  /** The translations of live templates, by type, channel and locale. */
  private static liveTranslations = async (): Promise<Map<string, TranslationRow>> => {
    const client = TemplateService.client;
    const [rows, channels, translations] = await Promise.all([
      client.templates.findMany({}),
      client.templateChannels.findMany({}),
      client.templateTranslations.findMany({}),
    ]);
    const types = new Map(rows.map((row) => [row.id, row.type]));
    const owners = new Map(channels.map((channel) => [channel.id, channel]));
    return new Map(
      translations.flatMap((translation) => {
        const channel = owners.get(translation.templateChannelId);
        const type = channel && types.get(channel.templateId);
        return type && channel
          ? [[translationKey(type, channel.channel, translation.locale), translation] as const]
          : [];
      }),
    );
  };

  static get = async (templateId: string) => {
    const template = await TemplateService.client.templates.findFirst({
      where: { id: templateId },
    });
    if (!template) throw new ChaskiError('not_found', `template '${templateId}' not found`);
    const channels = await TemplateService.client.templateChannels.findMany({
      where: { templateId },
      orderBy: [{ channel: 'asc' }],
    });
    const translations = await TranslationService.ofChannels(channels);
    return {
      template,
      channels: channels.map((channel) => ({
        ...channel,
        translations: translations.get(channel.id) ?? [],
      })),
    };
  };

  // Counterpart to `get` for callers that address templates by `type`.
  static getByType = async (type: string) => {
    const template = await TemplateService.client.templates.findFirst({ where: { type } });
    if (!template) throw new ChaskiError('not_found', `template for type '${type}' not found`);
    return TemplateService.get(template.id);
  };

  static updateTemplate = async (
    templateId: string,
    input: { description?: string | null; topic?: string | null; sampleData?: string | null },
  ) => {
    await TemplateService.get(templateId);
    const updated = await TemplateService.client.templates.update({
      where: { id: templateId },
      data: input,
    });
    await publishAdminEvents(['templates']);
    return updated;
  };

  static deleteTemplate = async (templateId: string): Promise<void> => {
    await TemplateService.get(templateId);
    await TemplateService.client.templates.delete({ where: { id: templateId } });
    await publishAdminEvents(['templates']);
  };

  // Retention/repair escape hatch. Never use this for an ordinary user delete:
  // unlike soft deletion it physically cascades to template channel content and translations.
  static purgeTemplate = async (templateId: string): Promise<void> => {
    const deleted = await TemplateService.client.templates.findFirst({
      where: { id: templateId },
      deleted: 'only',
    });
    if (!deleted) throw new ChaskiError('not_found', `deleted template '${templateId}' not found`);
    await TemplateService.client.templates.delete({ where: { id: templateId }, mode: 'hard' });
    await publishAdminEvents(['templates', 'locales']);
  };

  static upsertChannel = async (
    templateId: string,
    channel: Channel,
    input: ChannelContentInput,
  ) => {
    assertTemplates({ subject: input.subject, body: input.body, textBody: input.textBody });
    await TemplateService.get(templateId);
    const existing = await TemplateService.client.templateChannels.findFirst({
      where: { templateId, channel },
    });
    const row = existing
      ? await TemplateService.client.templateChannels.update({
          where: { id: existing.id },
          data: input,
        })
      : await TemplateService.client.templateChannels.create({
          data: {
            id: newId('tc'),
            templateId,
            channel,
            enabled: input.enabled ?? false,
            subject: input.subject ?? null,
            body: input.body ?? null,
            textBody: input.textBody ?? null,
          },
        });
    await publishAdminEvents(['templates']);
    return row;
  };

  /**
   * Renders a channel with sample data as a contact asking for `locale` would get it: the stored
   * content, resolved like a send, or `content` while it's being edited, in that language.
   */
  static preview = async (
    templateId: string,
    channel: Channel,
    options: {
      data?: Record<string, unknown>;
      content?: { subject?: string | null; body: string; textBody?: string | null };
      locale?: string;
    } = {},
  ): Promise<RenderedPreview> => {
    const { template, channels } = await TemplateService.get(templateId);
    const row = channels.find((c) => c.channel === channel);
    const requested = options.locale ?? null;
    let resolved: ResolvedContent | null = null;
    if (options.content) {
      resolved = {
        subject: options.content.subject ?? null,
        body: options.content.body,
        textBody: options.content.textBody ?? null,
        locale: requested ?? TemplateService.config.locales?.default ?? null,
      };
    } else if (row?.body) {
      resolved = await TranslationService.resolve({ ...row, body: row.body }, requested);
    }
    if (!resolved?.body) {
      throw new ChaskiError('not_found', `template has no ${channel} content to preview`);
    }

    assertTemplates({
      subject: resolved.subject,
      body: resolved.body,
      textBody: resolved.textBody,
    });
    const sample = options.data ?? parseJson<Record<string, unknown>>(template.sampleData, {});
    const recipient = sample.recipient as { timezone?: unknown } | undefined;
    const timeZone = typeof recipient?.timezone === 'string' ? recipient.timezone : undefined;
    const rendered = await renderFields(
      resolved,
      { ...sample, ...(resolved.locale ? { locale: resolved.locale } : {}) },
      { html: channel === 'email', format: localeFormat(resolved.locale, requested, timeZone) },
    );
    return {
      subject: rendered.subject,
      html: rendered.body,
      text: rendered.textBody,
      locale: resolved.locale,
    };
  };

  /** Sends the saved email, in `locale` as a send would resolve it, to one address. */
  static testSend = async (
    templateId: string,
    input: { to: string; data?: Record<string, unknown>; locale?: string },
  ): Promise<{ messageId?: string; locale: string | null }> => {
    const { channels, problems } = TemplateService.config;
    const email = channels.email;
    if (problems.email) throw new ChaskiError('config', problems.email);
    if (!email) throw new ChaskiError('validation', 'the email channel is not configured');

    const rendered = await TemplateService.preview(templateId, 'email', {
      data: input.data,
      locale: input.locale,
    });
    try {
      const { messageId } = await EmailSenderService.send({
        to: input.to,
        from: senderAddress(email.from, email.fromName),
        replyTo: email.replyTo,
        subject: `[test] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      });
      return { messageId, locale: rendered.locale };
    } catch (error) {
      if (error instanceof DeliveryError)
        throw new ChaskiError(error.permanent ? 'validation' : 'internal', error.message);
      throw error;
    }
  };
}
