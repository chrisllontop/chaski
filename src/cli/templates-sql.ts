import { ChaskiError } from '../contract/errors';
import { templateFileSchema, templateWarnings } from '../contract/template-file';
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

/**
 * The statements that apply a template file the way templates.import() does, for
 * `wrangler d1 execute --file`: templates upsert by type among the live ones, absent fields store
 * null, channels the file leaves out keep their content, and a row whose content already matches
 * isn't written, so running the file twice changes nothing. They follow the schema of the
 * migrations this package ships, so the database needs them applied first. The warnings are the
 * import's: content worth a look, written as it is.
 */
export const templatesToSql = (rawFile: unknown): { statements: string[]; warnings: string[] } => {
  const file = parseInput(templateFileSchema, rawFile);
  const statements: string[] = [];
  const warnings = file.templates.flatMap((record) =>
    templateWarnings(record).map((warning) => `${record.type}: ${warning.message}`),
  );
  for (const record of file.templates) {
    for (const content of record.channels) {
      const at = `${record.type} ${content.channel}`;
      assertTemplates({
        [`${at} subject`]: content.subject,
        [`${at} body`]: content.body,
        [`${at} textBody`]: content.textBody,
      });
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
      const statement =
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
        'OR template_channels.text_body IS NOT excluded.text_body';
      if (new TextEncoder().encode(statement).length > MAX_STATEMENT_BYTES) {
        throw new ChaskiError(
          'validation',
          `${record.type} ${content.channel} is too large for one D1 statement (100 KB)`,
        );
      }
      statements.push(statement);
    }
  }
  return { statements, warnings };
};
