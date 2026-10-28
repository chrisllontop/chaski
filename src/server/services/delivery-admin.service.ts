import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { type DeliveryStatus, deliveries, notifications } from '../db/schema';
import { publishAdminEvents } from '../lib/admin-events';
import { parseJson } from '../lib/json';
import type { DeliveryMessage } from '../types';
import { AttachmentService } from './attachment.service';
import { BaseService } from './base.service';
import type { ContactSnapshot } from './contact.service';

export type DeliveryFilters = {
  /** Deliveries whose last status change falls in [from, to). */
  from?: Date;
  to?: Date;
  status?: DeliveryStatus;
  channel?: Channel;
  type?: string;
  recipientId?: string;
  opened?: boolean;
};

const REPLAYABLE: DeliveryStatus[] = ['failed', 'dead'];

/** Held deliveries to act on: these ids, or every one of a channel or a type. */
export type HeldSelection = { ids?: string[]; channel?: Channel; type?: string };

// A queue's sendBatch takes at most 100 messages.
const SEND_BATCH_SIZE = 100;
// What one request sends or discards at most, held or dead alike; the rest wait for the next.
const BULK_LIMIT = 500;

const filterConditions = (filters: DeliveryFilters): SQL[] => {
  const conditions: SQL[] = [];
  if (filters.from) conditions.push(gte(deliveries.updatedAt, filters.from));
  if (filters.to) conditions.push(lt(deliveries.updatedAt, filters.to));
  if (filters.status) conditions.push(eq(deliveries.status, filters.status));
  if (filters.channel) conditions.push(eq(deliveries.channel, filters.channel));
  if (filters.type) conditions.push(eq(notifications.type, filters.type));
  if (filters.recipientId) conditions.push(eq(notifications.recipientId, filters.recipientId));
  if (filters.opened === true) conditions.push(isNotNull(deliveries.openedAt));
  if (filters.opened === false) conditions.push(isNull(deliveries.openedAt));
  return conditions;
};

const toMessage = (row: {
  id: string;
  notificationId: string;
  channel: string;
  type: string;
  recipientId: string;
}): DeliveryMessage => ({
  kind: 'chaski.delivery',
  deliveryId: row.id,
  notificationId: row.notificationId,
  channel: row.channel as Channel,
  type: row.type,
  recipientId: row.recipientId,
});

export class DeliveryAdminService extends BaseService {
  protected static override name = 'delivery';

  private static selectRows = () =>
    DeliveryAdminService.db
      .select({
        id: deliveries.id,
        notificationId: deliveries.notificationId,
        channel: deliveries.channel,
        status: deliveries.status,
        skipReason: deliveries.skipReason,
        attempts: deliveries.attempts,
        lastError: deliveries.lastError,
        errorCode: deliveries.errorCode,
        providerMessageId: deliveries.providerMessageId,
        sentAt: deliveries.sentAt,
        providerMs: deliveries.providerMs,
        openedAt: deliveries.openedAt,
        updatedAt: deliveries.updatedAt,
        createdAt: notifications.createdAt,
        type: notifications.type,
        recipientId: notifications.recipientId,
        contactSnapshot: notifications.contactSnapshot,
        payload: notifications.payload,
      })
      .from(deliveries)
      .innerJoin(notifications, eq(notifications.id, deliveries.notificationId));

  private static present = (
    row: Awaited<ReturnType<ReturnType<typeof DeliveryAdminService.selectRows>['all']>>[number],
  ) => {
    const { contactSnapshot, payload, ...delivery } = row;
    const snapshot = parseJson<ContactSnapshot>(contactSnapshot, {});
    return {
      ...delivery,
      sentAt: delivery.sentAt?.toISOString() ?? null,
      openedAt: delivery.openedAt?.toISOString() ?? null,
      updatedAt: delivery.updatedAt.toISOString(),
      createdAt: delivery.createdAt.toISOString(),
      // Only email targets one address; push and in_app reach the recipient's
      // devices and feed.
      address: delivery.channel === 'email' ? (snapshot.email ?? null) : null,
      payload: parseJson<Record<string, unknown>>(payload, {}),
    };
  };

  static list = async (filters: DeliveryFilters & { page: number; limit: number }) => {
    const conditions = filterConditions(filters);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, total] = await Promise.all([
      DeliveryAdminService.selectRows()
        .where(where)
        .orderBy(desc(deliveries.updatedAt), desc(deliveries.id))
        .limit(filters.limit)
        .offset(filters.page * filters.limit)
        .all(),
      DeliveryAdminService.db
        .select({ total: sql<number>`count(*)` })
        .from(deliveries)
        .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
        .where(where)
        .get(),
    ]);
    return {
      deliveries: rows.map(DeliveryAdminService.present),
      total: total?.total ?? 0,
      page: filters.page,
      limit: filters.limit,
    };
  };

  static get = async (deliveryId: string) => {
    const row = await DeliveryAdminService.selectRows().where(eq(deliveries.id, deliveryId)).get();
    if (!row) throw new ChaskiError('not_found', `delivery '${deliveryId}' not found`);
    return DeliveryAdminService.present(row);
  };

  /** Deliveries per status under the other filters, so every status tab counts in one query. */
  static counts = async (filters: Omit<DeliveryFilters, 'status'>) => {
    const conditions = filterConditions(filters);
    const rows = await DeliveryAdminService.db
      .select({ status: deliveries.status, count: sql<number>`count(*)` })
      .from(deliveries)
      .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(deliveries.status)
      .all();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  };

  static replay = async (deliveryId: string): Promise<{ requeued: number }> => {
    const requeued = await DeliveryAdminService.requeue([deliveryId], REPLAYABLE);
    if (requeued === 0) {
      const row = await DeliveryAdminService.client.deliveries.findFirst({
        where: { id: deliveryId },
      });
      if (!row) throw new ChaskiError('not_found', `delivery '${deliveryId}' not found`);
      throw new ChaskiError(
        'conflict',
        `delivery '${deliveryId}' is ${row.status}; only failed and dead deliveries replay`,
      );
    }
    return { requeued };
  };

  static replayDead = async (): Promise<{ requeued: number }> => {
    const rows = await DeliveryAdminService.client.deliveries.findMany({
      where: { status: 'dead' },
      take: BULK_LIMIT,
    });
    return {
      requeued: await DeliveryAdminService.requeue(
        rows.map((row) => row.id),
        REPLAYABLE,
      ),
    };
  };

  /**
   * Sends held deliveries through the queue. One on a channel that is still paused stays held:
   * resuming the channel comes first, and a selection with nothing else answers why.
   */
  static sendHeld = async (selection: HeldSelection): Promise<{ sent: number }> => {
    const rows = await DeliveryAdminService.heldRows(selection);
    const paused = new Set(
      (await DeliveryAdminService.client.channelPauses.findMany({})).map((row) => row.channel),
    );
    const sendable = rows.filter((row) => !paused.has(row.channel));
    if (rows.length > 0 && sendable.length === 0) {
      const channels = [...new Set(rows.map((row) => row.channel))].join(', ');
      throw new ChaskiError(
        'conflict',
        `${channels} is paused: resume it to send what it holds, or discard it`,
      );
    }
    const sent = await DeliveryAdminService.requeue(
      sendable.map((row) => row.id),
      ['held'],
    );
    return { sent };
  };

  /** Drops held deliveries for good, with the attachments only their email would have sent. */
  static discardHeld = async (selection: HeldSelection): Promise<{ discarded: number }> => {
    const rows = await DeliveryAdminService.heldRows(selection);
    if (rows.length === 0) return { discarded: 0 };
    const db = DeliveryAdminService.db;
    const discarded = await db
      .update(deliveries)
      .set({ status: 'skipped', skipReason: 'discarded', updatedAt: new Date() })
      .where(
        and(
          inArray(
            deliveries.id,
            rows.map((row) => row.id),
          ),
          eq(deliveries.status, 'held'),
        ),
      )
      .returning({ id: deliveries.id, channel: deliveries.channel });
    const emails = new Set(discarded.filter((row) => row.channel === 'email').map((row) => row.id));
    for (const row of rows) {
      if (emails.has(row.id)) {
        await AttachmentService.discard(row.attachments, { deliveryId: row.id, channel: 'email' });
      }
    }
    DeliveryAdminService.log.info('held deliveries discarded', { count: discarded.length });
    await publishAdminEvents(['deliveries', 'metrics']);
    return { discarded: discarded.length };
  };

  private static heldRows = (selection: HeldSelection) => {
    const conditions = [eq(deliveries.status, 'held')];
    if (selection.ids) conditions.push(inArray(deliveries.id, selection.ids));
    if (selection.channel) conditions.push(eq(deliveries.channel, selection.channel));
    if (selection.type) conditions.push(eq(notifications.type, selection.type));
    return DeliveryAdminService.db
      .select({
        id: deliveries.id,
        channel: deliveries.channel,
        attachments: notifications.attachments,
      })
      .from(deliveries)
      .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
      .where(and(...conditions))
      .orderBy(deliveries.updatedAt)
      .limit(BULK_LIMIT)
      .all();
  };

  // The conditional update decides which deliveries go back on the queue, so two admins
  // acting at once never enqueue the same delivery twice.
  private static requeue = async (ids: string[], from: DeliveryStatus[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const db = DeliveryAdminService.db;
    const claimed = await db
      .update(deliveries)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(and(inArray(deliveries.id, ids), inArray(deliveries.status, from)))
      .returning({ id: deliveries.id });
    if (claimed.length === 0) return 0;

    const rows = await db
      .select({
        id: deliveries.id,
        notificationId: deliveries.notificationId,
        channel: deliveries.channel,
        type: notifications.type,
        recipientId: notifications.recipientId,
      })
      .from(deliveries)
      .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
      .where(
        inArray(
          deliveries.id,
          claimed.map((row) => row.id),
        ),
      )
      .all();
    const queue = DeliveryAdminService.bindings.queue;
    for (let i = 0; i < rows.length; i += SEND_BATCH_SIZE) {
      await queue.sendBatch(
        rows.slice(i, i + SEND_BATCH_SIZE).map((row) => ({ body: toMessage(row) })),
      );
    }
    DeliveryAdminService.log.info('deliveries requeued', { count: rows.length, from: from.join() });
    await publishAdminEvents(['deliveries', 'metrics']);
    return rows.length;
  };
}
