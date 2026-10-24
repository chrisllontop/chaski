import { Hono } from 'hono';
import { z } from 'zod';
import { channelSchema } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
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

export const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ChaskiError('validation', parsed.error.issues.map((i) => i.message).join('; '));
  }
  return parsed.data;
};

export const admin = new Hono();

admin.get('/templates', async (c) => c.json({ templates: await TemplateService.list() }));

admin.get('/templates/deleted', async (c) =>
  c.json({ templates: await TemplateService.listDeleted() }),
);

admin.post('/templates', async (c) => {
  const input = parseBody(templateInputSchema, await c.req.json());
  const template = await TemplateService.createTemplate(input);
  return c.json({ template }, 201);
});

admin.get('/templates/:id', async (c) => c.json(await TemplateService.get(c.req.param('id'))));

admin.patch('/templates/:id', async (c) => {
  const input = parseBody(templatePatchSchema, await c.req.json());
  return c.json({ template: await TemplateService.updateTemplate(c.req.param('id'), input) });
});

admin.delete('/templates/:id', async (c) => {
  const id = c.req.param('id');
  await TemplateService.deleteTemplate(id);
  return c.json({ id, deleted: true as const });
});

admin.put('/templates/:id/channels/:channel', async (c) => {
  const channel = parseBody(channelSchema, c.req.param('channel'));
  const input = parseBody(channelContentSchema, await c.req.json());
  const row = await TemplateService.upsertChannel(c.req.param('id'), channel, input);
  return c.json({ channel: row });
});

admin.post('/templates/:id/preview', async (c) => {
  const input = parseBody(
    z.object({
      channel: channelSchema,
      data: z.record(z.string(), z.unknown()).optional(),
    }),
    await c.req.json(),
  );
  return c.json(await TemplateService.preview(c.req.param('id'), input.channel, input.data));
});
