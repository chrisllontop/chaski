import { z } from 'zod';

export const CHANNELS = ['email', 'in_app', 'push'] as const;
export const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;

export const recipientSchema = z.object({
  id: z.string().min(1).max(256),
  email: z.string().email().optional(),
  name: z.string().max(256).optional(),
  phone: z.string().max(32).optional(),
  timezone: z.string().max(64).optional(),
  locale: z.string().max(16).optional(),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const attachmentInputSchema = z
  .object({
    filename: z.string().min(1).max(256),
    contentType: z.string().min(1).max(128),
    content: z.string().optional(),
    url: z.string().url().optional(),
    disposition: z.enum(['attachment', 'inline']).optional(),
    contentId: z.string().max(128).optional(),
  })
  .refine((a) => Boolean(a.content) !== Boolean(a.url), {
    message: 'attachment requires exactly one of content or url',
  });
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const emailOptionsSchema = z.object({
  fromName: z.string().max(256).optional(),
  replyTo: z.string().email().optional(),
  attachments: z.array(attachmentInputSchema).max(10).optional(),
});

// A wall-clock time without an explicit UTC offset names a different instant
// in every timezone, so it is rejected instead of guessed.
export const OFFSET_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const typeNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_.-]+$/i);

// Keys Chaski's pushes already carry, and the ones APNs and FCM keep for themselves.
const RESERVED_DATA_KEYS = new Set(['aps', 'href', 'tag', 'from', 'message_type', 'collapse_key']);

// What a send hands its clients, as is: the feed item and every push carry it, so a client can
// match a push to its feed item. FCM data and WNS launch arguments only hold strings, so the
// values are strings, and a key that would collide in any of them is refused.
export const notificationDataSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, {
      message: 'data keys are letters, digits and _, start with a letter and run to 64',
    }),
    z.string().max(1024),
  )
  .refine((data) => Object.keys(data).length <= 20, { message: 'data takes at most 20 keys' })
  .refine(
    (data) =>
      Object.keys(data).every((key) => {
        const lower = key.toLowerCase();
        return !RESERVED_DATA_KEYS.has(lower) && !/^(google|gcm)/.test(lower);
      }),
    {
      message:
        'data keys may not be aps, href, tag, from, message_type, collapse_key, or start with ' +
        'google or gcm',
    },
  );

// A silent push still shows its alert, without a sound; on Android the app's notification
// channel decides the sound. The collapse id replaces a push already shown with the same one,
// and becomes the push's `tag`, so an app can give its own notification of the same event that
// id; APNs takes at most 64 bytes.
export const pushOptionsSchema = z.object({
  silent: z.boolean().optional(),
  collapseId: z
    .string()
    .regex(/^[\x21-\x7E]{1,64}$/, {
      message: 'push.collapseId is 1 to 64 printable ASCII characters, without spaces',
    })
    .optional(),
});

export const sendRequestSchema = z.object({
  type: typeNameSchema,
  recipient: recipientSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  channels: z.array(channelSchema).min(1).optional(),
  transactional: z.boolean().default(false),
  email: emailOptionsSchema.optional(),
  push: pushOptionsSchema.optional(),
  data: notificationDataSchema.optional(),
  idempotencyKey: z.string().min(1).max(512).optional(),
  // Delivers the email within the call instead of through the queue, so a provider failure
  // reaches the caller; only for one transactional email (see NotificationService.send).
  inline: z.boolean().default(false),
});
export type SendRequest = z.input<typeof sendRequestSchema>;

// A schedule with an idempotencyKey is upserted by it: declaring it again with
// another scheduledAt moves the pending schedule instead of adding one, so the
// key must not be derived from the time.
export const scheduleRequestSchema = sendRequestSchema.omit({ inline: true }).extend({
  scheduledAt: z.string().regex(OFFSET_TIMESTAMP_REGEX, {
    message: 'scheduledAt must be ISO 8601 with an explicit offset (Z or ±hh:mm)',
  }),
  groupKey: z.string().min(1).max(512).optional(),
});
export type ScheduleRequest = z.input<typeof scheduleRequestSchema>;

export const cancelScheduledSchema = z
  .object({
    id: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
    groupKey: z.string().min(1).optional(),
  })
  .refine((q) => q.id || q.idempotencyKey || q.groupKey, {
    message: 'one of id, idempotencyKey or groupKey is required',
  });
export type CancelScheduledQuery = z.infer<typeof cancelScheduledSchema>;

export type ScheduledItem = {
  id: string;
  recipientId: string;
  type: string;
  scheduledAt: string;
  groupKey?: string;
  idempotencyKey?: string;
};

// 'completed': the key already fired. 'cancelled': the new time is already
// past, so the pending schedule is retired instead of firing late.
export type ScheduleOp = 'created' | 'updated' | 'completed' | 'cancelled';

export type ScheduleResult = {
  scheduledId: string;
  scheduledAt: string;
  op: ScheduleOp;
};

export const webPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(256),
  }),
});
export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;

// APNs device tokens are opaque hex (64 characters today; Apple may grow them).
export const apnsDeviceTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[0-9a-fA-F]+$/, { message: 'deviceToken must be a hex string' });

const opaqueTokenSchema = z.string().min(32).max(4096);

// FCM registration tokens are opaque and, unlike APNs tokens, case-sensitive.
export const fcmTokenSchema = opaqueTokenSchema.regex(/^\S+$/, {
  message: 'deviceToken must be an FCM registration token',
});

// Chaski posts its WNS access token to the channel URI, so a URI on any host other than
// Microsoft's notify.windows.com, whose subdomains change, is refused. Registration is the only
// way a channel reaches the database.
const isWnsChannelUri = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const { protocol, hostname } = new URL(value);
  return (
    protocol === 'https:' &&
    (hostname === 'notify.windows.com' || hostname.endsWith('.notify.windows.com'))
  );
};

const wnsChannelUriSchema = z.string().max(2048).refine(isWnsChannelUri, {
  message: 'deviceToken must be a WNS channel URI on notify.windows.com',
});

// Unregistering doesn't name the platform, so it takes any kind of token;
// an APNs hex token has the shape of an FCM one.
const anyDeviceTokenSchema = opaqueTokenSchema.regex(/^\S+$/, {
  message:
    'deviceToken must be an APNs device token, an FCM registration token or a WNS channel URI',
});

// A token belongs to the APNs environment of the build that made it: a development build's
// token only works in sandbox. Without one here, the environment of the platform's app in the
// config applies.
const apnsDeviceFields = {
  deviceToken: apnsDeviceTokenSchema,
  environment: z.enum(['sandbox', 'production']).optional(),
};

const iosDeviceSchema = z.object({ platform: z.literal('ios'), ...apnsDeviceFields });
const macosDeviceSchema = z.object({ platform: z.literal('macos'), ...apnsDeviceFields });
const androidDeviceSchema = z.object({
  platform: z.literal('android'),
  deviceToken: fcmTokenSchema,
});
const windowsDeviceSchema = z.object({
  platform: z.literal('windows'),
  deviceToken: wnsChannelUriSchema,
});

/** A device token from an app: APNs for iOS and macOS, FCM for Android, WNS for Windows. */
export const nativeDeviceSchema = z.discriminatedUnion('platform', [
  iosDeviceSchema,
  macosDeviceSchema,
  androidDeviceSchema,
  windowsDeviceSchema,
]);
export type NativeDevice = z.input<typeof nativeDeviceSchema>;

const registrationFields = {
  recipient: recipientSchema,
  userAgent: z.string().max(512).optional(),
};

// The native shapes come first so their `platform` literal drives the error a
// malformed native registration gets.
export const registerPushSubscriptionSchema = z.union([
  z.discriminatedUnion('platform', [
    iosDeviceSchema.extend(registrationFields),
    macosDeviceSchema.extend(registrationFields),
    androidDeviceSchema.extend(registrationFields),
    windowsDeviceSchema.extend(registrationFields),
  ]),
  z.object({ ...registrationFields, subscription: webPushSubscriptionSchema }),
]);
export type RegisterPushSubscriptionRequest = z.input<typeof registerPushSubscriptionSchema>;

export const unregisterPushSubscriptionSchema = z
  .object({
    recipientId: z.string().min(1).max(256).optional(),
    endpoint: z.string().url().max(2048).optional(),
    deviceToken: anyDeviceTokenSchema.optional(),
  })
  .refine((q) => q.recipientId || q.endpoint || q.deviceToken, {
    message: 'one of recipientId, endpoint or deviceToken is required',
  });
export type UnregisterPushSubscriptionQuery = z.infer<typeof unregisterPushSubscriptionSchema>;

// Channel entries merge key by key (absent keys keep their value) while
// mutedTypes overwrites the whole list: the app owns it as a set, and a merge
// would make unmuting impossible. An entry may target one channel with a
// `channel:` prefix ('push:reminder.*'); without one it mutes every channel.
export const preferencesUpdateSchema = z.object({
  channels: z.partialRecord(channelSchema, z.boolean()).optional(),
  mutedTypes: z.array(z.string().min(1).max(128)).max(200).optional(),
});
export type PreferencesUpdate = z.input<typeof preferencesUpdateSchema>;

export type ChaskiPreferences = {
  channels: Partial<Record<Channel, boolean>>;
  mutedTypes: string[];
};

export const listFeedQuerySchema = z.object({
  recipientId: z.string().min(1).max(256),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  unreadOnly: z.boolean().optional(),
});
export type ListFeedQuery = z.input<typeof listFeedQuerySchema>;

// ids marks those items; before marks everything up to that instant
// (inclusive); neither marks the recipient's whole unread feed.
export const markFeedReadSchema = z.object({
  recipientId: z.string().min(1).max(256),
  ids: z.array(z.string().min(1)).max(100).optional(),
  before: z
    .string()
    .regex(OFFSET_TIMESTAMP_REGEX, { message: 'before must be ISO 8601 with an explicit offset' })
    .optional(),
});
export type MarkFeedReadInput = z.input<typeof markFeedReadSchema>;

export const feedItemSchema = z.object({
  id: z.string(),
  /** The notification the item came from: its pushes carry the same id as their `tag`. */
  notificationId: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  href: z.string().optional(),
  /** The send's `data`, as it came. */
  data: z.record(z.string(), z.string()).nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

// A new item arrives whole, as the feed lists it, so a client can show it without a request;
// the feed API stays the source of truth for pages and reads. Clients ignore types they don't
// know, so the protocol can grow without breaking older bundles. A read names the items it
// marked (`ids`), every item created up to `before`, or both.
export const feedSocketEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('feed_item.created'),
    item: feedItemSchema,
  }),
  z.object({
    type: z.literal('feed_item.read'),
    ids: z.array(z.string().min(1)).optional(),
    before: z.string().optional(),
  }),
]);
export type FeedSocketEvent = z.infer<typeof feedSocketEventSchema>;

/** What a web push carries; Chaski's service worker shows it as a notification. */
export type PushPayload = {
  title: string;
  body: string;
  href?: string;
  /** The send's `push.collapseId`, or the notification id: a repeated push replaces itself. */
  tag?: string;
  /** Shows the notification without a sound. */
  silent?: boolean;
  /** The send's `data`, as it came. */
  data?: Record<string, string>;
};

export type FeedPage = {
  items: FeedItem[];
  nextCursor: string | null;
};

// The user routes read the recipient from identify(), never from the
// client, so their bodies and queries carry no recipient id.
export const feedListParamsSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unreadOnly: z.stringbool().optional(),
});
export type FeedListParams = z.input<typeof feedListParamsSchema>;

export const markFeedReadBodySchema = markFeedReadSchema.omit({ recipientId: true });
export type MarkFeedReadBody = z.input<typeof markFeedReadBodySchema>;

export const deviceSubscriptionSchema = z.union([nativeDeviceSchema, webPushSubscriptionSchema]);
export type DeviceSubscription = z.input<typeof deviceSubscriptionSchema>;

export const deviceUnsubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2048).optional(),
    deviceToken: anyDeviceTokenSchema.optional(),
  })
  .refine((q) => q.endpoint || q.deviceToken, {
    message: 'one of endpoint or deviceToken is required',
  });
export type DeviceUnsubscription = z.input<typeof deviceUnsubscriptionSchema>;

export type DeliveryResult = {
  id?: string;
  channel: Channel;
  status: 'pending' | 'sent' | 'skipped';
  reason?: string;
};

// 'suppressed' = every channel skipped by the recipient's own preferences;
// 'undeliverable' = configuration or contact data prevented every channel.
export type SendOutcome = 'delivered' | 'suppressed' | 'undeliverable';

export type SendResult = {
  notificationId: string;
  replayed: boolean;
  outcome: SendOutcome;
  deliveries: DeliveryResult[];
};
