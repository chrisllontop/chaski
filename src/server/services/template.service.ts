import { sql } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { notifications } from '../db/schema';
import { DeliveryError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { renderTemplate } from '../lib/render';
import { BaseService } from './base.service';
import { EmailSenderService } from './email-sender.service';

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
};

export type ActiveChannelContent = {
  templateId: string;
  subject: string | null;
  body: string;
  textBody: string | null;
};

// A channel only renders in production when it is enabled AND has a body;
// toggling a channel off (or leaving it unconfigured) skips it at dispatch.
const isLive = (row: {
  enabled: boolean;
  body: string | null;
}): row is typeof row & {
  body: string;
} => row.enabled && Boolean(row.body?.trim());

export class TemplateService extends BaseService {
  static hasType = async (type: string): Promise<boolean> => {
    const row = await TemplateService.client.templates.findFirst({ where: { type } });
    return Boolean(row);
  };

  static typeNames = async (): Promise<string[]> => {
    const rows = await TemplateService.client.templates.findMany({ orderBy: [{ type: 'asc' }] });
    return rows.map((row) => row.type);
  };

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
  ): Promise<ActiveChannelContent | null> => {
    const template = await TemplateService.client.templates.findFirst({ where: { type } });
    if (!template) return null;
    const row = await TemplateService.client.templateChannels.findFirst({
      where: { templateId: template.id, channel },
    });
    if (!row || !isLive(row)) return null;
    return {
      templateId: template.id,
      subject: row.subject,
      body: row.body as string,
      textBody: row.textBody,
    };
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
    const lastUsedByType = new Map(lastUsedRows.map((row) => [row.type, row.lastUsedAt]));
    return rows.map((row) => ({
      ...row,
      lastUsedAt:
        lastUsedByType.get(row.type) == null
          ? null
          : new Date(lastUsedByType.get(row.type) as number).toISOString(),
      channels: channels
        .filter((c) => c.templateId === row.id)
        .map((c) => ({ channel: c.channel, enabled: isLive(c) })),
    }));
  };

  // Audit/recovery path. Ordinary reads remain active-only through the
  // soft-delete plugin; callers must opt in explicitly to see tombstones.
  static listDeleted = async () =>
    TemplateService.client.templates.findMany({
      deleted: 'only',
      orderBy: [{ deletedAt: 'desc' }, { type: 'asc' }],
    });

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
    return created;
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
    return { template, channels };
  };

  // Counterpart to `get` for callers that address templates by `type`.
  static getByType = async (type: string) => {
    const template = await TemplateService.client.templates.findFirst({ where: { type } });
    if (!template) throw new ChaskiError('not_found', `template for type '${type}' not found`);
    const channels = await TemplateService.client.templateChannels.findMany({
      where: { templateId: template.id },
      orderBy: [{ channel: 'asc' }],
    });
    return { template, channels };
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
    return updated;
  };

  static deleteTemplate = async (templateId: string): Promise<void> => {
    await TemplateService.get(templateId);
    await TemplateService.client.templates.delete({ where: { id: templateId } });
  };

  // Retention/repair escape hatch. Never use this for an ordinary user delete:
  // unlike soft deletion it physically cascades to template channel content.
  static purgeTemplate = async (templateId: string): Promise<void> => {
    const deleted = await TemplateService.client.templates.findFirst({
      where: { id: templateId },
      deleted: 'only',
    });
    if (!deleted) throw new ChaskiError('not_found', `deleted template '${templateId}' not found`);
    await TemplateService.client.templates.delete({ where: { id: templateId }, mode: 'hard' });
  };

  static upsertChannel = async (
    templateId: string,
    channel: Channel,
    input: ChannelContentInput,
  ) => {
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
    return row;
  };

  static preview = async (
    templateId: string,
    channel: Channel,
    data?: Record<string, unknown>,
  ): Promise<RenderedPreview> => {
    const { template, channels } = await TemplateService.get(templateId);
    const row = channels.find((c) => c.channel === channel);
    if (!row?.body) {
      throw new ChaskiError('not_found', `template has no ${channel} content to preview`);
    }

    const sample = data ?? parseJson<Record<string, unknown>>(template.sampleData, {});
    const [subject, html, text] = await Promise.all([
      renderTemplate(row.subject ?? '', sample),
      renderTemplate(row.body, sample),
      row.textBody ? renderTemplate(row.textBody, sample) : Promise.resolve(undefined),
    ]);
    return { subject, html, text };
  };

  static previewContent = async (
    input: { subject?: string | null; body: string; textBody?: string | null },
    data: Record<string, unknown>,
  ): Promise<RenderedPreview> => {
    const [subject, html, text] = await Promise.all([
      renderTemplate(input.subject ?? '', data),
      renderTemplate(input.body, data),
      input.textBody ? renderTemplate(input.textBody, data) : Promise.resolve(undefined),
    ]);
    return { subject, html, text };
  };

  static testSend = async (
    templateId: string,
    input: { to: string; data?: Record<string, unknown> },
  ): Promise<{ messageId?: string }> => {
    const email = TemplateService.config.channels.email;
    if (!email) throw new ChaskiError('validation', 'the email channel is not configured');

    const rendered = await TemplateService.preview(templateId, 'email', input.data);
    try {
      return await EmailSenderService.send({
        to: input.to,
        from: email.fromName ? `${email.fromName} <${email.from}>` : email.from,
        replyTo: email.replyTo,
        subject: `[test] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (error) {
      if (error instanceof DeliveryError)
        throw new ChaskiError(error.permanent ? 'validation' : 'internal', error.message);
      throw error;
    }
  };
}
