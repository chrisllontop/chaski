import { Liquid, LiquidError } from 'liquidjs';
import { ChaskiError } from '../../contract/errors';

// Lenient variable resolution mirrors SendGrid: a missing payload key renders
// empty instead of failing the whole delivery.
const liquid = new Liquid({ cache: 500 });

// A template Liquid can't parse or render is the author's to fix: a validation
// error, so a delivery fails at once instead of retrying the same mistake.
const invalid = (error: unknown, label: string) =>
  error instanceof LiquidError
    ? new ChaskiError('validation', `${label}: ${error.message}`)
    : error;

export const renderTemplate = async (
  template: string,
  data: Record<string, unknown>,
): Promise<string> => {
  try {
    return await liquid.parseAndRender(template, data);
  } catch (error) {
    throw invalid(error, 'Liquid');
  }
};

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
