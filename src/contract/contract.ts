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
  idempotencyKey: z.string().min(1).max(512).optional(),
});
export type SendRequest = z.input<typeof sendRequestSchema>;

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
