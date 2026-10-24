import { z } from 'zod';
import { channelSchema, typeNameSchema } from './contract';

// The file the dashboard downloads and uploads to carry templates between
// environments, staging to production say. Templates are keyed by type, so
// uploading the same file twice changes nothing; format and version let a
// later Chaski read an older file and refuse one it does not know.
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
 * What importing a template does: `fields` lists what an update overwrites,
 * as `topic` or `channels.email.body`; a channel the template lacks shows as
 * `channels.push`. Channels the file leaves out are never touched.
 */
export type TemplateChange = {
  type: string;
  change: 'create' | 'update' | 'unchanged';
  fields: string[];
};

/** The same list with or without preview, so the dashboard shows it before and after. */
export type TemplateImportResult = {
  applied: boolean;
  changes: TemplateChange[];
};
