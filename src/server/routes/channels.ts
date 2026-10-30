import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { channelSchema } from '../../contract/contract';
import { signedIn } from '../auth';
import type { SettingsSection } from '../db/schema';
import { parseInput } from '../lib/validate';
import { ChannelService } from '../services/channel.service';
import { SettingsService } from '../services/settings.service';

// A save changes what's given: an omitted field keeps the saved value, a null or blank one clears
// it (.agents/types.md), and an omitted secret keeps the saved one. What a value must be is
// validateConfig's to say, so a saved section and the config fail with the same message.
const text = (max: number) => z.string().trim().max(max);

const clearable = (max: number) =>
  text(max)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));

const emailSchema = z.object({
  from: text(320).optional(),
  fromName: clearable(128),
  replyTo: clearable(320),
});

const vapidSchema = z.object({
  subject: text(512).optional(),
  publicKey: text(256).optional(),
  privateKey: text(4096).optional(),
  // A key pair other than the saved one stops every browser subscribed with it.
  replace: z.boolean().optional(),
});

const generateVapidSchema = vapidSchema.pick({ subject: true, replace: true });

const apnsAppSchema = z
  .object({
    bundleId: text(256),
    environment: text(32).transform((value) => value as 'sandbox' | 'production'),
  })
  .nullable()
  .optional();

const apnsSchema = z.object({
  teamId: text(64).optional(),
  keyId: text(64).optional(),
  privateKey: text(8192).optional(),
  ios: apnsAppSchema,
  macos: apnsAppSchema,
});

const fcmSchema = z.object({ serviceAccount: text(16_384).optional() });

const wnsSchema = z.object({
  tenantId: text(128).optional(),
  clientId: text(128).optional(),
  clientSecret: text(1024).optional(),
});

const providerSchema = z.enum(['vapid', 'apns', 'fcm', 'wns']);

const resumeSchema = z.object({ send: z.boolean().default(false) });

const saved = async (
  c: Context,
  section: Exclude<SettingsSection, 'default_muted_types' | 'locales'>,
) => c.json({ settings: (await SettingsService.sections())[section] });

const removed = async (c: Context, section: SettingsSection) => {
  await SettingsService.remove(section, signedIn(c));
  return c.json({ id: section, deleted: true as const });
};

/** Each channel's state and settings; anyone Access lets in can change them, as with a pause. */
export const channels = new Hono();

channels.get('/', async (c) => c.json(await ChannelService.overview()));

channels.put('/email', async (c) => {
  await SettingsService.saveEmail(parseInput(emailSchema, await c.req.json()), signedIn(c));
  return saved(c, 'email');
});

channels.delete('/email', (c) => removed(c, 'email'));

channels.put('/in_app', async (c) => {
  await SettingsService.saveInApp(signedIn(c));
  return saved(c, 'in_app');
});

channels.delete('/in_app', (c) => removed(c, 'in_app'));

channels.post('/push/vapid/generate', async (c) => {
  const input = parseInput(generateVapidSchema, await c.req.json());
  await SettingsService.generateVapid(input, signedIn(c));
  return saved(c, 'vapid');
});

channels.put('/push/:provider', async (c) => {
  const provider = parseInput(providerSchema, c.req.param('provider'));
  const actor = signedIn(c);
  const body = await c.req.json();
  if (provider === 'vapid') await SettingsService.saveVapid(parseInput(vapidSchema, body), actor);
  if (provider === 'apns') await SettingsService.saveApns(parseInput(apnsSchema, body), actor);
  if (provider === 'fcm') await SettingsService.saveFcm(parseInput(fcmSchema, body), actor);
  if (provider === 'wns') await SettingsService.saveWns(parseInput(wnsSchema, body), actor);
  return saved(c, provider);
});

channels.delete('/push/:provider', (c) =>
  removed(c, parseInput(providerSchema, c.req.param('provider'))),
);

channels.post('/:channel/pause', async (c) => {
  const actor = signedIn(c);
  await ChannelService.pause(parseInput(channelSchema, c.req.param('channel')), actor);
  return c.json({ paused: true });
});

channels.post('/:channel/resume', async (c) => {
  const actor = signedIn(c);
  const { send } = parseInput(resumeSchema, await c.req.json());
  return c.json(
    await ChannelService.resume(parseInput(channelSchema, c.req.param('channel')), actor, {
      send,
    }),
  );
});
