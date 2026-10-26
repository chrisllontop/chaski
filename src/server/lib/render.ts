import { filters, Liquid, LiquidError } from 'liquidjs';
import { ChaskiError } from '../../contract/errors';

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

// A template Liquid can't parse or render is the author's to fix: a validation
// error, so a delivery fails at once instead of retrying the same mistake.
const invalid = (error: unknown, label: string) =>
  error instanceof LiquidError
    ? new ChaskiError('validation', `${label}: ${error.message}`)
    : error;

const render = async (engine: Liquid, template: string, data: Record<string, unknown>) => {
  try {
    return await engine.parseAndRender(template, data);
  } catch (error) {
    throw invalid(error, 'Liquid');
  }
};

export const renderTemplate = (template: string, data: Record<string, unknown>): Promise<string> =>
  render(liquid, template, data);

/** Renders an email body: every output is HTML-escaped unless it ends in `| raw`. */
export const renderHtml = (template: string, data: Record<string, unknown>): Promise<string> =>
  render(htmlLiquid, template, data);

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
