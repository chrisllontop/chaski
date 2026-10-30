import { z } from 'zod';
import { channelSchema, typeNameSchema } from './contract';
import { htmlEntities, isPlainTextField } from './html-entities';
import { canonicalLocale, localeSchema } from './locales';

// The file that carries templates from a repository, or from another
// environment, into Chaski through templates().import(). Templates are
// keyed by type, so loading the same file twice changes nothing; format and
// version let a later Chaski read an older file and refuse one it does not know.
export const TEMPLATE_FILE_FORMAT = 'chaski.templates';
export const TEMPLATE_FILE_VERSION = 2;

const TRANSLATED_FIELDS = ['subject', 'body', 'textBody'] as const;

// Every field is the translation's own: one left out is empty, never the default's.
export const templateTranslationSchema = z.object({
  subject: z.string().max(512).nullable().optional(),
  body: z.string().refine((body) => body.trim() !== '', { message: 'a translation needs a body' }),
  textBody: z.string().nullable().optional(),
  // Written from default content that changed since; it stays outdated after an import, until
  // someone saves it again or marks it current.
  outdated: z.boolean().optional(),
});
export type TemplateTranslation = z.input<typeof templateTranslationSchema>;

// Keyed by locale, read in canonical form, so `es-pe` and `es-PE` can't both slip in.
const translationsSchema = z
  .record(z.string(), templateTranslationSchema)
  .transform((translations, ctx) => {
    const canonical: Record<string, z.output<typeof templateTranslationSchema>> = {};
    for (const [tag, translation] of Object.entries(translations)) {
      const locale = canonicalLocale(tag);
      if (!locale || locale in canonical) {
        ctx.addIssue({
          code: 'custom',
          path: [tag],
          message: locale
            ? `'${tag}' names ${locale} again`
            : `'${tag}' is not a BCP 47 language tag`,
        });
        continue;
      }
      canonical[locale] = translation;
    }
    return canonical;
  });

const channelFields = {
  channel: channelSchema,
  enabled: z.boolean(),
  subject: z.string().max(512).nullable().optional(),
  body: z.string().nullable().optional(),
  textBody: z.string().nullable().optional(),
};

const recordFields = {
  type: typeNameSchema,
  description: z.string().max(512).nullable().optional(),
  topic: z.string().min(1).max(128).nullable().optional(),
  sampleData: z.string().nullable().optional(),
};

export const templateRecordSchema = z.object({
  ...recordFields,
  channels: z
    .array(z.object({ ...channelFields, translations: translationsSchema.optional() }))
    .default([]),
});
export type TemplateRecord = z.input<typeof templateRecordSchema>;

// zod drops keys it doesn't know, so a version 1 file that carries translations is refused
// rather than imported without them.
const NEEDS_VERSION_2 = 'translations need a file of version 2';

const v1RecordSchema = z.object({
  ...recordFields,
  channels: z
    .array(
      z.object({
        ...channelFields,
        translations: z.undefined({ message: NEEDS_VERSION_2 }).optional(),
      }),
    )
    .default([]),
});

// A type listed twice would make the preview promise one result and the
// import deliver another.
const uniqueTypes = (templates: Array<{ type: string }>, ctx: z.RefinementCtx) => {
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
};

const v1FileSchema = z.object({
  format: z.literal(TEMPLATE_FILE_FORMAT),
  version: z.literal(1),
  defaultLocale: z.undefined({ message: NEEDS_VERSION_2 }).optional(),
  templates: z.array(v1RecordSchema).superRefine(uniqueTypes),
});

// defaultLocale names the language of the default content. The import refuses a file whose
// default isn't the Worker's, and one with translations while the Worker has no languages.
const v2FileSchema = z
  .object({
    format: z.literal(TEMPLATE_FILE_FORMAT),
    version: z.literal(2),
    defaultLocale: localeSchema.nullable().optional(),
    templates: z.array(templateRecordSchema).superRefine(uniqueTypes),
  })
  .superRefine((file, ctx) => {
    file.templates.forEach((template, index) => {
      template.channels.forEach((content, at) => {
        for (const locale of Object.keys(content.translations ?? {})) {
          const path = ['templates', index, 'channels', at, 'translations', locale];
          if (!file.defaultLocale) {
            ctx.addIssue({
              code: 'custom',
              path,
              message: 'a file with translations names its defaultLocale',
            });
          } else if (locale === file.defaultLocale) {
            ctx.addIssue({
              code: 'custom',
              path,
              message: `${locale} is the default language: its content is the channel's own`,
            });
          }
        }
      });
    });
  });

export const templateFileSchema = z.discriminatedUnion('version', [v1FileSchema, v2FileSchema]);
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
 * as `topic`, `channels.email.body` or `channels.email.translations.es.subject`; a channel or a
 * translation the template lacks shows as `channels.push` or `channels.email.translations.es`.
 * Channels and translations the file leaves out are never touched.
 */
export type TemplateChange = {
  type: string;
  change: 'create' | 'update' | 'unchanged';
  fields: string[];
  warnings: TemplateWarning[];
};

const entityWarnings = (
  channel: z.infer<typeof channelSchema>,
  prefix: string,
  content: Partial<Record<(typeof TRANSLATED_FIELDS)[number], string | null>>,
): TemplateWarning[] =>
  TRANSLATED_FIELDS.flatMap((name): TemplateWarning[] => {
    const entities = isPlainTextField(channel, name) ? htmlEntities(content[name]) : [];
    if (entities.length === 0) return [];
    const field = `${prefix}.${name}`;
    return [
      {
        field,
        code: 'html_entities',
        entities,
        message: `${field} is plain text and shows ${entities.join(', ')} as typed`,
      },
    ];
  });

// Content written for HTML, or brought from another provider, often carries entities into a
// subject or a push; Chaski sends text as written, so it says so rather than decoding them.
export const templateWarnings = (record: TemplateRecord): TemplateWarning[] =>
  (record.channels ?? []).flatMap((content) => [
    ...entityWarnings(content.channel, `channels.${content.channel}`, content),
    ...Object.entries(content.translations ?? {}).flatMap(([locale, translation]) =>
      entityWarnings(
        content.channel,
        `channels.${content.channel}.translations.${locale}`,
        translation,
      ),
    ),
  ]);

/** The same list with or without preview, so the dashboard shows it before and after. */
export type TemplateImportResult = {
  applied: boolean;
  changes: TemplateChange[];
};
