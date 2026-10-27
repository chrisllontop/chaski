import { and, eq, inArray } from 'drizzle-orm';
import type {
  AttachmentInput,
  Channel,
  DeliveryResult,
  SendOutcome,
  SendResult,
} from '../../contract/contract';
import { sendRequestSchema } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { deliveries, notifications } from '../db/schema';
import { publishAdminEvents } from '../lib/admin-events';
import { newId } from '../lib/ids';
import { resolveChannels } from '../lib/resolve-channels';
import { parseInput } from '../lib/validate';
import type { DeliveryMessage } from '../types';
import { loadCapabilities } from './adapters/registry';
import type { DeliveryRow } from './adapters/types';
import type { StoredAttachment } from './attachment.service';
import { AttachmentService } from './attachment.service';
import { BaseService } from './base.service';
import type { ContactSnapshot } from './contact.service';
import { ContactService } from './contact.service';
import { DeliveryService } from './delivery.service';
import { PreferenceService } from './preference.service';
import { TemplateService } from './template.service';

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

// muted_by_preferences is the recipient's own choice; every other skip reason
// is configuration or contact data the caller should hear about.
const outcomeOf = (deliveries: DeliveryResult[]): SendOutcome => {
  if (deliveries.some((d) => d.status !== 'skipped')) return 'delivered';
  if (deliveries.length > 0 && deliveries.every((d) => d.reason === 'muted_by_preferences')) {
    return 'suppressed';
  }
  return 'undeliverable';
};

// Ingest-only guard; dispatch keeps the channel_not_configured skip so
// scheduled sends survive the host dropping a channel before they fire.
export const assertChannelsConfigured = (
  enabledChannels: Channel[],
  channels?: Channel[],
): void => {
  const missing = channels?.filter((c) => !enabledChannels.includes(c)) ?? [];
  if (missing.length > 0) {
    throw new ChaskiError('validation', `channels not configured: ${missing.join(', ')}`);
  }
};

// Ingest-only as well: an unknown type is a caller bug and rejected outright,
// while dispatch keeps the per-channel no_template skip so scheduled sends
// survive channel-content edits between ingest and dispatch.
export const assertKnownType = async (type: string): Promise<void> => {
  if (!(await TemplateService.hasType(type))) {
    throw new ChaskiError(
      'validation',
      `unknown notification type '${type}': register a template for it before sending`,
    );
  }
};

// An inline send answers to someone waiting on one email, such as a password reset: preferences
// can't skip it, and with a single channel it either went out or the caller hears why not.
const assertInline = (request: { transactional: boolean; channels?: Channel[] }): void => {
  if (!request.transactional || request.channels?.length !== 1 || request.channels[0] !== 'email') {
    throw new ChaskiError(
      'validation',
      "an inline send delivers one email: it needs transactional: true and channels: ['email']",
    );
  }
};

// A template Liquid can't render is the caller's to fix, as at ingest; anything else is the
// provider's answer, with the code the adapter classified it under.
const deliveryFailed = (delivery: DeliveryRow): ChaskiError =>
  delivery.errorCode === 'validation'
    ? new ChaskiError('validation', delivery.lastError ?? 'the email template failed to render')
    : new ChaskiError(
        'delivery_failed',
        `the email didn't go out: ${delivery.lastError ?? 'the provider refused it'} ` +
          `(${delivery.errorCode ?? 'unknown'}, delivery ${delivery.id})`,
      );

export const splitEmailOptions = (
  email: { fromName?: string; replyTo?: string; attachments?: AttachmentInput[] } | undefined,
): {
  attachments: AttachmentInput[];
  overrides: { fromName?: string; replyTo?: string } | null;
} => {
  const { attachments = [], ...overrides } = email ?? {};
  return {
    attachments,
    overrides: Object.values(overrides).some((value) => value !== undefined) ? overrides : null,
  };
};

export type DispatchInput = {
  type: string;
  recipientId: string;
  snapshot: ContactSnapshot;
  payload: Record<string, unknown>;
  channels?: Channel[];
  transactional: boolean;
  emailOverrides: { fromName?: string; replyTo?: string } | null;
  storedAttachments: StoredAttachment[];
  idempotencyKey: string | null;
  inline?: boolean;
};

export class NotificationService extends BaseService {
  protected static override name = 'notification';

  static send = async (rawRequest: unknown): Promise<SendResult> => {
    const request = parseInput(sendRequestSchema, rawRequest);
    if (request.inline) assertInline(request);
    assertChannelsConfigured(NotificationService.config.enabledChannels, request.channels);
    await assertKnownType(request.type);

    if (request.idempotencyKey) {
      const existing = await NotificationService.findByIdempotencyKey(request.idempotencyKey);
      if (existing) return request.inline ? NotificationService.retryInline(existing) : existing;
    }

    const snapshot = await ContactService.upsertFromRecipient(request.recipient);
    const { attachments, overrides } = splitEmailOptions(request.email);
    const storedAttachments = await AttachmentService.store(newId('att'), attachments);

    return NotificationService.dispatch({
      type: request.type,
      recipientId: request.recipient.id,
      snapshot,
      payload: request.payload,
      channels: request.channels,
      transactional: request.transactional,
      emailOverrides: overrides,
      storedAttachments,
      idempotencyKey: request.idempotencyKey ?? null,
      inline: request.inline,
    });
  };

  static dispatch = async (input: DispatchInput): Promise<SendResult> => {
    const { enabledChannels } = NotificationService.config;
    const requested = input.channels ?? enabledChannels;
    const [capabilities, templateFlags, preferences] = await Promise.all([
      loadCapabilities(input.recipientId, requested),
      TemplateService.activeChannelFlags(input.type, requested),
      input.transactional ? null : PreferenceService.get(input.recipientId),
    ]);

    const resolutions = resolveChannels({
      requestedChannels: input.channels,
      transactional: input.transactional,
      type: input.type,
      enabledChannels,
      preferences,
      contact: input.snapshot,
      capabilities,
      templatesByChannel: templateFlags,
    });
    // Checked before anything is stored: an inline email that would be skipped is the caller's to fix.
    const skipped = input.inline ? resolutions.find((r) => r.skipReason) : undefined;
    if (skipped) {
      throw new ChaskiError(
        'validation',
        `the inline email would be skipped: ${skipped.skipReason}`,
      );
    }

    const notificationId = newId('n');
    const now = new Date();
    const deliveryRows = resolutions.map((resolution) => ({
      id: newId('d'),
      notificationId,
      channel: resolution.channel,
      status: resolution.skipReason ? 'skipped' : 'pending',
      skipReason: resolution.skipReason ?? null,
      updatedAt: now,
    }));

    const db = NotificationService.db;
    try {
      await db.batch([
        db.insert(notifications).values({
          id: notificationId,
          recipientId: input.recipientId,
          type: input.type,
          payload: JSON.stringify(input.payload),
          contactSnapshot: JSON.stringify(input.snapshot),
          attachments:
            input.storedAttachments.length > 0 ? JSON.stringify(input.storedAttachments) : null,
          emailOverrides: input.emailOverrides ? JSON.stringify(input.emailOverrides) : null,
          transactional: input.transactional,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
        }),
        ...deliveryRows.map((row) => db.insert(deliveries).values(row)),
      ]);
    } catch (error) {
      if (input.idempotencyKey && isUniqueConstraintError(error)) {
        const existing = await NotificationService.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          NotificationService.log.info('notification replayed', {
            notificationId: existing.notificationId,
          });
          return existing;
        }
      }
      throw error;
    }

    const pendingMessages: DeliveryMessage[] = deliveryRows
      .filter((row) => row.status === 'pending')
      .map((row) => ({
        kind: 'chaski.delivery',
        deliveryId: row.id,
        notificationId,
        channel: row.channel,
        type: input.type,
        recipientId: input.recipientId,
      }));

    // A send delivers through the queue unless it's inline; `transactional` only decides whether
    // recipient preferences apply (see resolveChannels).
    const inlineMessage = input.inline ? pendingMessages[0] : undefined;
    if (inlineMessage) {
      const delivered = await DeliveryService.deliverInline(inlineMessage);
      await publishAdminEvents(['deliveries', 'metrics']);
      if (delivered.status !== 'sent') throw deliveryFailed(delivered);
    } else {
      await NotificationService.enqueue(pendingMessages);
      await publishAdminEvents(['deliveries', 'metrics']);
    }

    const results: DeliveryResult[] = deliveryRows.map((row) => ({
      id: row.id,
      channel: row.channel as Channel,
      status: row.status === 'skipped' ? 'skipped' : inlineMessage ? 'sent' : 'pending',
      reason: row.skipReason ?? undefined,
    }));

    NotificationService.log.info('notification dispatched', {
      notificationId,
      channels: results.length,
      transactional: input.transactional,
    });
    return { notificationId, replayed: false, outcome: outcomeOf(results), deliveries: results };
  };

  static enqueue = async (messages: DeliveryMessage[]): Promise<void> => {
    if (messages.length > 0) {
      await NotificationService.bindings.queue.sendBatch(messages.map((body) => ({ body })));
    }
  };

  // The same key tries a failed inline email again, so a person who asks once more gets another
  // attempt, and claiming the row first keeps two retries from both sending. An email that went
  // out, or is going out, replays as it stands: a key never sends twice.
  private static retryInline = async (existing: SendResult): Promise<SendResult> => {
    const email = existing.deliveries.find((d) => d.channel === 'email');
    if (!email?.id) return existing;
    const claimed = await NotificationService.db
      .update(deliveries)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(and(eq(deliveries.id, email.id), inArray(deliveries.status, ['failed', 'dead'])));
    if (claimed.meta.changes === 0) return existing;

    const notification = await NotificationService.client.notifications.findFirst({
      where: { id: existing.notificationId },
    });
    if (!notification) return existing;
    const delivered = await DeliveryService.deliverInline({
      kind: 'chaski.delivery',
      deliveryId: email.id,
      notificationId: notification.id,
      channel: 'email',
      type: notification.type,
      recipientId: notification.recipientId,
    });
    await publishAdminEvents(['deliveries', 'metrics']);
    if (delivered.status !== 'sent') throw deliveryFailed(delivered);
    const results = existing.deliveries.map((d) =>
      d.id === email.id ? { ...d, status: 'sent' as const } : d,
    );
    return { ...existing, outcome: outcomeOf(results), deliveries: results };
  };

  private static findByIdempotencyKey = async (
    idempotencyKey: string,
  ): Promise<SendResult | null> => {
    const existing = await NotificationService.client.notifications.findFirst({
      where: { idempotencyKey },
    });
    if (!existing) return null;
    const rows = await NotificationService.client.deliveries.findMany({
      where: { notificationId: existing.id },
    });
    const results: DeliveryResult[] = rows.map((d) => ({
      id: d.id,
      channel: d.channel as Channel,
      status: d.status === 'skipped' ? 'skipped' : d.status === 'sent' ? 'sent' : 'pending',
      reason: d.skipReason ?? undefined,
    }));
    return {
      notificationId: existing.id,
      replayed: true,
      outcome: outcomeOf(results),
      deliveries: results,
    };
  };
}
