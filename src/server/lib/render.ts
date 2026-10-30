import { filters, Liquid, LiquidError } from 'liquidjs';
import { ChaskiError } from '../../contract/errors';
import { LOCALE_FILTERS, type LocaleFormat } from '../../contract/liquid-filters';

// Lenient variable resolution mirrors SendGrid: a missing payload key renders
// empty instead of failing the whole delivery.
const liquid = new Liquid({ cache: 500 });

// An email body is HTML, and its values often come from people (a contact's name, a comment), so
// every output is escaped unless it ends in `| raw`. escape_once leaves a value the template
// already passed through `| escape` as it is. liquidjs types its filter registry loosely, but
// escape_once is a plain handler.
const htmlLiquid = new Liquid({
  cache: 500,
  outputEscape: filters.escape_once as (value: unknown) => string,
});

// The format rides in the render's globals under a symbol, which no template variable can name,
// so a payload key never changes how a value is formatted.
const FORMAT = Symbol('chaski.format');

/** With no languages saved there's no language to render in, and the filters format in English. */
const DEFAULT_FORMAT: LocaleFormat = { locale: 'en' };

/** How a delivery formats: in the language it renders in, in the contact's timezone. */
export const localeFormat = (
  locale: string | null,
  timeZone: string | null | undefined,
): LocaleFormat => ({ locale: locale ?? DEFAULT_FORMAT.locale, ...(timeZone ? { timeZone } : {}) });

// What liquidjs binds `this` to in a filter, as far as these filters read it.
type FilterThis = { context: { globals: object } };

const formatOf = (filter: FilterThis): LocaleFormat =>
  (filter.context.globals as { [FORMAT]?: LocaleFormat })[FORMAT] ?? DEFAULT_FORMAT;

for (const engine of [liquid, htmlLiquid]) {
  for (const { name, format } of LOCALE_FILTERS) {
    engine.registerFilter(name, function (this: FilterThis, value: unknown, ...args: unknown[]) {
      return format(value, formatOf(this), ...args);
    });
  }
}

// A template Liquid can't parse or render is the author's to fix: a validation
// error, so a delivery fails at once instead of retrying the same mistake.
const invalid = (error: unknown, label: string) =>
  error instanceof LiquidError
    ? new ChaskiError('validation', `${label}: ${error.message}`)
    : error;

const render = async (
  engine: Liquid,
  template: string,
  data: Record<string, unknown>,
  format: LocaleFormat = DEFAULT_FORMAT,
) => {
  try {
    return await engine.parseAndRender(template, data, { globals: { [FORMAT]: format } });
  } catch (error) {
    throw invalid(error, 'Liquid');
  }
};

export const renderTemplate = (
  template: string,
  data: Record<string, unknown>,
  format?: LocaleFormat,
): Promise<string> => render(liquid, template, data, format);

/** Renders an email body: every output is HTML-escaped unless it ends in `| raw`. */
export const renderHtml = (
  template: string,
  data: Record<string, unknown>,
  format?: LocaleFormat,
): Promise<string> => render(htmlLiquid, template, data, format);

/** Parses each field without rendering it, naming the first one Liquid rejects. */
export const assertTemplates = (fields: Record<string, string | null | undefined>): void => {
  for (const [label, template] of Object.entries(fields)) {
    if (!template) continue;
    try {
      liquid.parse(template);
    } catch (error) {
      throw invalid(error, label);
    }
  }
};

export type ChannelFields = { subject: string | null; body: string; textBody: string | null };

export type RenderedFields = { subject: string; body: string; textBody?: string };

/** Renders a channel's three fields; an email's body as HTML. */
export const renderFields = async (
  content: ChannelFields,
  data: Record<string, unknown>,
  options: { html: boolean; format?: LocaleFormat },
): Promise<RenderedFields> => {
  const [subject, body, textBody] = await Promise.all([
    renderTemplate(content.subject ?? '', data, options.format),
    (options.html ? renderHtml : renderTemplate)(content.body, data, options.format),
    content.textBody
      ? renderTemplate(content.textBody, data, options.format)
      : Promise.resolve(undefined),
  ]);
  return { subject, body, textBody };
};
