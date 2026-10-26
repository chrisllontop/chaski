import { Hono } from 'hono';
import { z } from 'zod';
import { channelSchema } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import {
  TEMPLATE_FILE_FORMAT,
  TEMPLATE_FILE_VERSION,
  templateFileSchema,
} from '../../contract/template-file';
import { actorOf } from '../auth';
import { DELIVERY_STATUS } from '../db/schema';
import { eventsStub } from '../durable/events';
import { logger } from '../lib/log';
import { parseInput } from '../lib/validate';
import { ChannelService } from '../services/channel.service';
import { DeliveryAdminService } from '../services/delivery-admin.service';
import { METRIC_PERIODS, MetricsService } from '../services/metrics.service';
import { TemplateService } from '../services/template.service';

const templateInputSchema = z.object({
  type: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9_.-]+$/i),
  description: z.string().max(512).nullable().optional(),
  topic: z.string().min(1).max(128).nullable().optional(),
  channels: z.array(channelSchema).optional(),
});

// Omitted = leave unchanged, explicit null = clear the field (types.mdc).
const templatePatchSchema = z.object({
  description: z.string().max(512).nullable().optional(),
  topic: z.string().min(1).max(128).nullable().optional(),
  sampleData: z.string().nullable().optional(),
});

const channelContentSchema = z.object({
  enabled: z.boolean().optional(),
  subject: z.string().max(512).nullable().optional(),
  body: z.string().nullable().optional(),
  textBody: z.string().nullable().optional(),
});

const deliveryFiltersSchema = z.object({
  status: z.enum(DELIVERY_STATUS).optional(),
  channel: channelSchema.optional(),
  type: z.string().max(128).optional(),
  recipientId: z.string().max(256).optional(),
  opened: z.stringbool().optional(),
});

const deliveryListSchema = deliveryFiltersSchema.extend({
  page: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const importQuerySchema = z.object({ preview: z.stringbool().default(false) });

const metricsQuerySchema = z.object({ period: z.enum(METRIC_PERIODS).default('30d') });

export const admin = new Hono();

const log = logger('admin');

// Every change made through the dashboard is logged under the actor that
// authorize let in.
admin.use(async (c, next) => {
  await next();
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return;
  log.info('admin action', {
    actor: actorOf(c)?.id,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
  });
});

admin.get('/templates', async (c) => c.json({ templates: await TemplateService.list() }));

admin.get('/templates/export', async (c) => {
  c.header('content-disposition', 'attachment; filename="chaski-templates.json"');
  return c.json({
    format: TEMPLATE_FILE_FORMAT,
    version: TEMPLATE_FILE_VERSION,
    templates: await TemplateService.exportTemplates(),
  });
});

admin.post('/templates/import', async (c) => {
  const { preview } = parseInput(importQuerySchema, c.req.query());
  const file = parseInput(templateFileSchema, await c.req.json());
  return c.json(await TemplateService.importTemplates(file.templates, { preview }));
});

admin.get('/templates/deleted', async (c) =>
  c.json({ templates: await TemplateService.listDeleted() }),
);

admin.post('/templates', async (c) => {
  const input = parseInput(templateInputSchema, await c.req.json());
  const template = await TemplateService.createTemplate(input);
  return c.json({ template }, 201);
});

admin.get('/templates/:id', async (c) => c.json(await TemplateService.get(c.req.param('id'))));

admin.patch('/templates/:id', async (c) => {
  const input = parseInput(templatePatchSchema, await c.req.json());
  return c.json({ template: await TemplateService.updateTemplate(c.req.param('id'), input) });
});

admin.delete('/templates/:id', async (c) => {
  const id = c.req.param('id');
  await TemplateService.deleteTemplate(id);
  return c.json({ id, deleted: true as const });
});

admin.put('/templates/:id/channels/:channel', async (c) => {
  const channel = parseInput(channelSchema, c.req.param('channel'));
  const input = parseInput(channelContentSchema, await c.req.json());
  const row = await TemplateService.upsertChannel(c.req.param('id'), channel, input);
  return c.json({ channel: row });
});

admin.post('/templates/:id/preview', async (c) => {
  const input = parseInput(
    z.object({
      channel: channelSchema,
      data: z.record(z.string(), z.unknown()).optional(),
    }),
    await c.req.json(),
  );
  return c.json(await TemplateService.preview(c.req.param('id'), input.channel, input.data));
});

admin.post('/templates/:id/test-send', async (c) => {
  const input = parseInput(
    z.object({
      to: z.string().email(),
      data: z.record(z.string(), z.unknown()).optional(),
    }),
    await c.req.json(),
  );
  return c.json(await TemplateService.testSend(c.req.param('id'), input));
});

// The dashboard's realtime socket; the 101 must pass through untouched.
admin.get('/events', async (c) => {
  const events = eventsStub();
  if (!events) {
    throw new ChaskiError('not_found', 'realtime events are off: bindings.events is missing');
  }
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'upgrade_required', message: 'expected a WebSocket upgrade' }, 426);
  }
  return events.fetch(c.req.raw);
});

admin.get('/channels', (c) => c.json(ChannelService.overview()));

admin.get('/deliveries', async (c) =>
  c.json(await DeliveryAdminService.list(parseInput(deliveryListSchema, c.req.query()))),
);

admin.get('/deliveries/counts', async (c) => {
  const { status: _status, ...filters } = parseInput(deliveryFiltersSchema, c.req.query());
  return c.json({ counts: await DeliveryAdminService.counts(filters) });
});

admin.post('/deliveries/replay-dead', async (c) => c.json(await DeliveryAdminService.replayDead()));

admin.get('/deliveries/:id', async (c) =>
  c.json({ delivery: await DeliveryAdminService.get(c.req.param('id')) }),
);

admin.post('/deliveries/:id/replay', async (c) =>
  c.json(await DeliveryAdminService.replay(c.req.param('id'))),
);

admin.get('/metrics/overview', async (c) =>
  c.json(await MetricsService.overview(parseInput(metricsQuerySchema, c.req.query()).period)),
);

admin.get('/metrics/timeseries', async (c) =>
  c.json(await MetricsService.timeseries(parseInput(metricsQuerySchema, c.req.query()).period)),
);

admin.get('/metrics/types', async (c) =>
  c.json(await MetricsService.byType(parseInput(metricsQuerySchema, c.req.query()).period)),
);
