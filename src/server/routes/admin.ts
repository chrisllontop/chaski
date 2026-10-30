import { Hono } from 'hono';
import { z } from 'zod';
import { channelSchema, OFFSET_TIMESTAMP_REGEX } from '../../contract/contract';
import { ChaskiError, isChaskiError } from '../../contract/errors';
import { actorOf, signedIn } from '../auth';
import { DELIVERY_STATUS } from '../db/schema';
import { eventsStub } from '../durable/events';
import { logger } from '../lib/log';
import { parseInput } from '../lib/validate';
import { DeliveryAdminService } from '../services/delivery-admin.service';
import { METRIC_PERIODS, MetricsService } from '../services/metrics.service';
import { ScheduleService } from '../services/schedule.service';
import { mutedTypesSchema, SettingsService } from '../services/settings.service';
import { TemplateService } from '../services/template.service';
import { channels } from './channels';

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

// Omitted = leave unchanged, explicit null = clear the field (.agents/types.md).
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

const instantSchema = z
  .string()
  .regex(OFFSET_TIMESTAMP_REGEX, { message: 'must be ISO 8601 with an explicit offset' })
  .transform((value) => new Date(value));

const deliveryFiltersSchema = z.object({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
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

const heldSelectionSchema = z
  .object({
    ids: z.array(z.string().max(64)).min(1).max(500).optional(),
    channel: channelSchema.optional(),
    type: z.string().max(128).optional(),
  })
  .refine((selection) => selection.ids || selection.channel || selection.type, {
    message: 'name the held deliveries: ids, a channel or a type',
  });

const scheduleListSchema = z.object({
  recipientId: z.string().max(256).optional(),
  groupKey: z.string().max(512).optional(),
  page: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const previewSchema = z.object({
  channel: channelSchema,
  data: z.record(z.string(), z.unknown()).optional(),
  // Content being edited and not saved yet; without it the stored content renders.
  content: z
    .object({
      subject: z.string().max(512).nullable().optional(),
      body: z.string(),
      textBody: z.string().nullable().optional(),
    })
    .optional(),
});

const metricsQuerySchema = z.object({ period: z.enum(METRIC_PERIODS).default('30d') });

export const admin = new Hono();

const log = logger('admin');

// Every change made through the dashboard is logged under the actor Access
// signed in.
// Previews change nothing, and the editor asks for one on every edit.
const READ_ONLY_POSTS = /\/preview(\/document)?$/;

admin.use(async (c, next) => {
  await next();
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return;
  if (READ_ONLY_POSTS.test(c.req.path)) return;
  log.info('admin action', {
    actor: actorOf(c)?.id,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
  });
});

admin.get('/me', (c) => c.json({ actor: actorOf(c) ?? null }));

admin.get('/templates', async (c) => c.json({ templates: await TemplateService.list() }));

admin.get('/templates/deleted', async (c) =>
  c.json({ templates: await TemplateService.listDeleted() }),
);

admin.post('/templates/:id/restore', async (c) =>
  c.json({ template: await TemplateService.restoreTemplate(c.req.param('id')) }),
);

admin.delete('/templates/:id/permanent', async (c) => {
  const id = c.req.param('id');
  await TemplateService.purgeTemplate(id);
  return c.json({ id, purged: true as const });
});

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

// The dashboard renders the email inside an iframe it posts this form into,
// so the email's own inline styles and remote images apply there without
// loosening the dashboard's CSP. The sandbox lets no script run.
const PREVIEW_DOCUMENT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src https: http: data:',
  'font-src https: data:',
  "frame-ancestors 'self'",
  'sandbox',
].join('; ');

const previewDocumentSchema = z.object({
  subject: z.string().max(512).optional(),
  body: z.string(),
  data: z
    .string()
    .optional()
    .transform((text, ctx) => {
      if (!text) return {};
      try {
        const value = JSON.parse(text) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // Reported below.
      }
      ctx.addIssue({ code: 'custom', message: 'data must be a JSON object' });
      return z.NEVER;
    }),
});

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

admin.post('/templates/:id/preview/document', async (c) => {
  const form = parseInput(previewDocumentSchema, await c.req.parseBody());
  const headers = {
    'Content-Security-Policy': PREVIEW_DOCUMENT_CSP,
    'X-Content-Type-Options': 'nosniff',
  };
  try {
    const rendered = await TemplateService.preview(c.req.param('id'), 'email', form.data, {
      subject: form.subject ?? null,
      body: form.body,
    });
    return c.html(rendered.html, 200, headers);
  } catch (error) {
    // The frame shows what's wrong with the draft being typed, not a JSON body.
    if (!isChaskiError(error) || error.code !== 'validation') throw error;
    return c.html(
      `<!doctype html><meta charset="utf-8"><pre style="margin:16px;font:12px/1.6 ui-monospace,monospace;color:#b91c1c;white-space:pre-wrap">${escapeHtml(error.message)}</pre>`,
      400,
      headers,
    );
  }
});

admin.post('/templates/:id/preview', async (c) => {
  const input = parseInput(previewSchema, await c.req.json());
  return c.json(
    await TemplateService.preview(c.req.param('id'), input.channel, input.data, input.content),
  );
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
    throw new ChaskiError(
      'not_found',
      'realtime events are off: the CHASKI_EVENTS binding is missing',
    );
  }
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'upgrade_required', message: 'expected a WebSocket upgrade' }, 426);
  }
  return events.fetch(c.req.raw);
});

admin.route('/channels', channels);

const defaultsSchema = z.object({ mutedTypes: mutedTypesSchema });

const defaults = async () => (await SettingsService.sections()).defaultMutedTypes;

// Type mutes every contact has until they save preferences of their own.
admin.get('/preferences/defaults', async (c) => c.json({ defaults: await defaults() }));

admin.put('/preferences/defaults', async (c) => {
  const actor = signedIn(c);
  const { mutedTypes } = parseInput(defaultsSchema, await c.req.json());
  await SettingsService.saveDefaultMutedTypes(mutedTypes, actor);
  return c.json({ defaults: await defaults() });
});

admin.get('/schedules', async (c) =>
  c.json(await ScheduleService.listPage(parseInput(scheduleListSchema, c.req.query()))),
);

admin.post('/schedules/:id/cancel', async (c) =>
  c.json(await ScheduleService.cancel({ id: c.req.param('id') })),
);

admin.get('/deliveries', async (c) =>
  c.json(await DeliveryAdminService.list(parseInput(deliveryListSchema, c.req.query()))),
);

admin.get('/deliveries/counts', async (c) => {
  const { status: _status, ...filters } = parseInput(deliveryFiltersSchema, c.req.query());
  return c.json({ counts: await DeliveryAdminService.counts(filters) });
});

admin.post('/deliveries/replay-dead', async (c) => c.json(await DeliveryAdminService.replayDead()));

admin.post('/deliveries/held/send', async (c) =>
  c.json(await DeliveryAdminService.sendHeld(parseInput(heldSelectionSchema, await c.req.json()))),
);

admin.post('/deliveries/held/discard', async (c) =>
  c.json(
    await DeliveryAdminService.discardHeld(parseInput(heldSelectionSchema, await c.req.json())),
  ),
);

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

admin.get('/metrics/latency', async (c) =>
  c.json(await MetricsService.latency(parseInput(metricsQuerySchema, c.req.query()).period)),
);
