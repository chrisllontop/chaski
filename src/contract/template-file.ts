import { z } from 'zod';
import { channelSchema, typeNameSchema } from './contract';
import { htmlEntities, isPlainTextField } from './html-entities';

// The file that carries templates from a repository, or from another
// environment, into Chaski through templates().import(). Templates are
// keyed by type, so loading the same file twice changes nothing; format and
// version let a later Chaski read an older file and refuse one it does not know.
export const TEMPLATE_FILE_FORMAT = 'chaski.templates';
export const TEMPLATE_FILE_VERSION = 1;

export const templateRecordSchema = z.object({
  type: typeNameSchema,
  description: z.string().max(512).nullable().optional(),
  topic: z.string().min(1).max(128).nullable().optional(),
  sampleData: z.string().nullable().optional(),
  channels: z
    .array(
      z.object({
        channel: channelSchema,
        enabled: z.boolean(),
        subject: z.string().max(512).nullable().optional(),
        body: z.string().nullable().optional(),
        textBody: z.string().nullable().optional(),
      }),
    )
    .default([]),
});
export type TemplateRecord = z.input<typeof templateRecordSchema>;

export const templateFileSchema = z.object({
  format: z.literal(TEMPLATE_FILE_FORMAT),
  version: z.literal(TEMPLATE_FILE_VERSION),
  // A type listed twice would make the preview promise one result and the
  // import deliver another.
  templates: z.array(templateRecordSchema).superRefine((templates, ctx) => {
    const seen = new Set<string>();
    templates.forEach((template, index) => {
      if (seen.has(template.type)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'type'],
          message: `type '${template.type}' appears more than once`,
        });
      }
      seen.add(template.type);
    });
  }),
});
export type TemplateFile = z.input<typeof templateFileSchema>;

/**
 * Something in a field worth a look before it goes out, which the import leaves as it is:
 * `html_entities` lists the entities a plain-text field would show as typed.
 */
export type TemplateWarning = {
  field: string;
  code: 'html_entities';
  entities: string[];
  message: string;
};

/**
 * What importing a template does: `fields` lists what an update overwrites,
 * as `topic` or `channels.email.body`; a channel the template lacks shows as
 * `channels.push`. Channels the file leaves out are never touched.
 */
export type TemplateChange = {
  type: string;
  change: 'create' | 'update' | 'unchanged';
  fields: string[];
  warnings: TemplateWarning[];
};

// Content written for HTML, or brought from another provider, often carries entities into a
// subject or a push; Chaski sends text as written, so it says so rather than decoding them.
export const templateWarnings = (record: TemplateRecord): TemplateWarning[] =>
  (record.channels ?? []).flatMap((content) =>
    (['subject', 'body', 'textBody'] as const).flatMap((name): TemplateWarning[] => {
      const entities = isPlainTextField(content.channel, name) ? htmlEntities(content[name]) : [];
      if (entities.length === 0) return [];
      const field = `channels.${content.channel}.${name}`;
      return [
        {
          field,
          code: 'html_entities',
          entities,
          message: `${field} is plain text and shows ${entities.join(', ')} as typed`,
        },
      ];
    }),
  );

/** The same list with or without preview, so the dashboard shows it before and after. */
export type TemplateImportResult = {
  applied: boolean;
  changes: TemplateChange[];
};
