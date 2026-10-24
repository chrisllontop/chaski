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
// the protocol can grow without breaking older bundles.
export const feedSocketEventSchema = z.object({
  type: z.literal('feed_item.created'),
  feedItemId: z.string().min(1),
  createdAt: z.string(),
});
export type FeedSocketEvent = z.infer<typeof feedSocketEventSchema>;

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
