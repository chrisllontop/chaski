import { ChaskiError } from '../contract/errors';
import { templateFileSchema, templateWarnings } from '../contract/template-file';
import { OUTDATED_HASH, sourceHash } from '../server/lib/fingerprint';
import { newId } from '../server/lib/ids';
import { assertTemplates } from '../server/lib/render';
import { parseInput } from '../server/lib/validate';

// D1 refuses a statement longer than this, so one channel's content has to fit in one.
const MAX_STATEMENT_BYTES = 100_000;

const NOW = "cast(unixepoch('subsecond') * 1000 as integer)";

const text = (value: string | null | undefined): string => {
  if (value === null || value === undefined) return 'NULL';
  if (value.includes('\0')) throw new ChaskiError('validation', 'a template holds a NUL character');
  return `'${value.replaceAll("'", "''")}'`;
};

const fits = (statement: string, at: string): string => {
  if (new TextEncoder().encode(statement).length > MAX_STATEMENT_BYTES) {
    throw new ChaskiError('validation', `${at} is too large for one D1 statement (100 KB)`);
  }
  return statement;
};

const SAVED_DEFAULT =
  "(SELECT json_extract(value, '$.default') FROM settings WHERE section = 'locales')";

/**
 * Refuses the file where templates.import() would: a default other than the Worker's, or
 * translations while the Worker has no languages. SQL can't raise an error of its own outside a
 * trigger, so the statement asks json_extract for a path that is the message, which fails with it.
 */
const defaultLocaleGuard = (defaultLocale: string, translated: boolean): string => {
  const differs = `${SAVED_DEFAULT} IS NOT ${text(defaultLocale)}`;
  const condition = translated ? differs : `${SAVED_DEFAULT} IS NOT NULL AND ${differs}`;
  // SQLite quotes the path back, doubling any apostrophe, so the message has none.
  const message =
    `Chaski: this file has its default content in ${defaultLocale}, so it loads only into a ` +
    `Chaski whose default language is ${defaultLocale}, saved on its Channels page`;
  return `SELECT CASE WHEN ${condition} THEN json_extract('{}', ${text(message)}) END`;
};

/**
 * The statements that apply a template file the way templates.import() does, for
 * `wrangler d1 execute --file`: templates upsert by type among the live ones, absent fields store
 * null, channels and translations the file leaves out keep their content, and a row whose content
 * already matches isn't written, so running the file twice changes nothing. They follow the
 * schema of the migrations this package ships, so the database needs them applied first. The
 * warnings are the import's: content worth a look, written as it is.
 */
export const templatesToSql = async (
  rawFile: unknown,
): Promise<{ statements: string[]; warnings: string[] }> => {
  const file = parseInput(templateFileSchema, rawFile);
  const statements: string[] = [];
  const warnings = file.templates.flatMap((record) =>
    templateWarnings(record).map((warning) => `${record.type}: ${warning.message}`),
  );
  const translated = file.templates.some((record) =>
    record.channels.some((content) => Object.keys(content.translations ?? {}).length > 0),
  );
  if (file.defaultLocale) statements.push(defaultLocaleGuard(file.defaultLocale, translated));

  for (const record of file.templates) {
    for (const content of record.channels) {
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

    const type = text(record.type);
    const live = `type = ${type} AND deleted_at IS NULL`;
    const description = text(record.description);
    const topic = text(record.topic);
    const sampleData = text(record.sampleData);
    statements.push(
      'INSERT INTO templates (id, type, description, topic, sample_data, created_at, updated_at) ' +
        `SELECT ${text(newId('tpl'))}, ${type}, ${description}, ${topic}, ${sampleData}, ${NOW}, ${NOW} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM templates WHERE ${live})`,
      `UPDATE templates SET description = ${description}, topic = ${topic}, ` +
        `sample_data = ${sampleData}, updated_at = ${NOW} WHERE ${live} AND ` +
        `(description IS NOT ${description} OR topic IS NOT ${topic} OR sample_data IS NOT ${sampleData})`,
    );
    for (const content of record.channels) {
      const at = `${record.type} ${content.channel}`;
      statements.push(
        fits(
          'INSERT INTO template_channels ' +
            '(id, template_id, channel, enabled, subject, body, text_body, created_at, updated_at) ' +
            `SELECT ${text(newId('tc'))}, id, ${text(content.channel)}, ${content.enabled ? 1 : 0}, ` +
            `${text(content.subject)}, ${text(content.body)}, ${text(content.textBody)}, ${NOW}, ${NOW} ` +
            `FROM templates WHERE ${live} ` +
            'ON CONFLICT (template_id, channel) DO UPDATE SET enabled = excluded.enabled, ' +
            'subject = excluded.subject, body = excluded.body, text_body = excluded.text_body, ' +
            'updated_at = excluded.updated_at WHERE template_channels.enabled IS NOT excluded.enabled ' +
            'OR template_channels.subject IS NOT excluded.subject ' +
            'OR template_channels.body IS NOT excluded.body ' +
            'OR template_channels.text_body IS NOT excluded.text_body',
          at,
        ),
      );

      const entries = Object.entries(content.translations ?? {});
      if (entries.length === 0) continue;
      // The fingerprint of the default content the file brings, which the channel holds once the
      // statement above ran; a translation the file marks outdated is stored as never matching.
      const currentHash = await sourceHash(content);
      const current = text(currentHash);
      for (const [locale, translation] of entries) {
        const hash = text(translation.outdated ? OUTDATED_HASH : currentHash);
        statements.push(
          fits(
            'INSERT INTO template_translations ' +
              '(template_channel_id, locale, subject, body, text_body, source_hash, created_at, updated_at) ' +
              `SELECT c.id, ${text(locale)}, ${text(translation.subject)}, ${text(translation.body)}, ` +
              `${text(translation.textBody)}, ${hash}, ${NOW}, ${NOW} ` +
              'FROM template_channels c JOIN templates t ON t.id = c.template_id ' +
              `WHERE t.type = ${type} AND t.deleted_at IS NULL AND c.channel = ${text(content.channel)} ` +
              'ON CONFLICT (template_channel_id, locale) DO UPDATE SET subject = excluded.subject, ' +
              'body = excluded.body, text_body = excluded.text_body, ' +
              'source_hash = excluded.source_hash, updated_at = excluded.updated_at ' +
              'WHERE template_translations.subject IS NOT excluded.subject ' +
              'OR template_translations.body IS NOT excluded.body ' +
              'OR template_translations.text_body IS NOT excluded.text_body ' +
              // Whether it reads as outdated, not the stored fingerprint, as the import compares.
              `OR (template_translations.source_hash = ${current}) IS NOT (excluded.source_hash = ${current})`,
            `${at} ${locale}`,
          ),
        );
      }
    }
  }
  return { statements, warnings };
};
