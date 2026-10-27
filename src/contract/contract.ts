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

export const sendRequestSchema = z.object({
  type: typeNameSchema,
  recipient: recipientSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  channels: z.array(channelSchema).min(1).optional(),
  transactional: z.boolean().default(false),
  email: emailOptionsSchema.optional(),
  idempotencyKey: z.string().min(1).max(512).optional(),
});
export type SendRequest = z.input<typeof sendRequestSchema>;

// A schedule with an idempotencyKey is upserted by it: declaring it again with
// another scheduledAt moves the pending schedule instead of adding one, so the
// key must not be derived from the time.
export const scheduleRequestSchema = sendRequestSchema.extend({
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

// The iOS shape comes first so its `platform` literal drives the error a
// malformed iOS registration gets.
export const registerPushSubscriptionSchema = z.union([
  z.object({
    recipient: recipientSchema,
    platform: z.literal('ios'),
    deviceToken: apnsDeviceTokenSchema,
    userAgent: z.string().max(512).optional(),
  }),
  z.object({
    recipient: recipientSchema,
    subscription: webPushSubscriptionSchema,
    userAgent: z.string().max(512).optional(),
  }),
]);
export type RegisterPushSubscriptionRequest = z.input<typeof registerPushSubscriptionSchema>;

export const unregisterPushSubscriptionSchema = z
  .object({
    recipientId: z.string().min(1).max(256).optional(),
    endpoint: z.string().url().max(2048).optional(),
    deviceToken: apnsDeviceTokenSchema.optional(),
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

// Socket events carry no title or body: they tell clients to refetch, and the
// feed API stays the source of truth. Clients ignore types they don't know, so
// the protocol can grow without breaking older bundles. A read names the items
// it marked (`ids`), every item created up to `before`, or both.
export const feedSocketEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('feed_item.created'),
    feedItemId: z.string().min(1),
    createdAt: z.string(),
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
  /** The notification id, so a repeated push shows once instead of twice. */
  tag?: string;
};

export type FeedItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  href?: string;
  readAt: string | null;
  createdAt: string;
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

export const deviceSubscriptionSchema = z.union([
  z.object({ platform: z.literal('ios'), deviceToken: apnsDeviceTokenSchema }),
  webPushSubscriptionSchema,
]);
export type DeviceSubscription = z.input<typeof deviceSubscriptionSchema>;

export const deviceUnsubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2048).optional(),
    deviceToken: apnsDeviceTokenSchema.optional(),
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
