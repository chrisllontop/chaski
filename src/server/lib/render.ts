import { Liquid } from 'liquidjs';

// Lenient variable resolution mirrors SendGrid: a missing payload key renders
// empty instead of failing the whole delivery.
const liquid = new Liquid({ cache: 500 });

export const renderTemplate = (template: string, data: Record<string, unknown>): Promise<string> =>
  liquid.parseAndRender(template, data);
