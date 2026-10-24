import { and, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { type DeliveryStatus, deliveries, notifications } from '../db/schema';
import { parseJson } from '../lib/json';
import type { DeliveryMessage } from '../types';
import { BaseService } from './base.service';
import type { ContactSnapshot } from './contact.service';

export type DeliveryFilters = {
  status?: DeliveryStatus;
  channel?: Channel;
  type?: string;
  recipientId?: string;
  opened?: boolean;
};

const REPLAYABLE: DeliveryStatus[] = ['failed', 'dead'];

// A queue's sendBatch takes at most 100 messages.
const SEND_BATCH_SIZE = 100;
const REPLAY_DEAD_LIMIT = 500;

const filterConditions = (filters: DeliveryFilters): SQL[] => {
  const conditions: SQL[] = [];
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
        .orderBy(desc(notifications.createdAt), desc(deliveries.id))
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
    const requeued = await DeliveryAdminService.requeue([deliveryId]);
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
      take: REPLAY_DEAD_LIMIT,
    });
    return { requeued: await DeliveryAdminService.requeue(rows.map((row) => row.id)) };
  };

  // The conditional update decides which deliveries replay, so two admins
  // replaying at once never enqueue the same delivery twice.
  private static requeue = async (ids: string[]): Promise<number> => {
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
      .where(and(inArray(deliveries.id, ids), inArray(deliveries.status, REPLAYABLE)))
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
    DeliveryAdminService.log.info('deliveries replayed', { count: rows.length });
    return rows.length;
  };
}
