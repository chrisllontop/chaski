import { and, eq } from 'drizzle-orm';
import type { Channel, ScheduledItem, ScheduleResult } from '../../contract/contract';
import { cancelScheduledSchema, scheduleRequestSchema } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { scheduledNotifications } from '../db/schema';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { parseInput } from '../lib/validate';
import type { StoredAttachment } from './attachment.service';
import { AttachmentService } from './attachment.service';
import { BaseService } from './base.service';
import type { ContactSnapshot } from './contact.service';
import { ContactService } from './contact.service';
import {
  assertChannelsConfigured,
  assertKnownType,
  NotificationService,
  splitEmailOptions,
} from './notification.service';

type ScheduledRow = typeof scheduledNotifications.$inferSelect;

// A schedule declared a few minutes late (clock skew, a slow caller) still
// counts as now instead of being rejected as past.
const SCHEDULE_GRACE_MS = 5 * 60_000;

export class ScheduleService extends BaseService {
  protected static override name = 'schedule';

  private static get scheduler(): Workflow {
    const scheduler = ScheduleService.bindings.scheduler;
    if (!scheduler) {
      throw new ChaskiError(
        'config',
        'Chaski config: bindings.scheduler is missing; chaski.schedule() needs the ChaskiScheduler Workflow',
      );
    }
    return scheduler;
  }

  static schedule = async (rawRequest: unknown): Promise<ScheduleResult> => {
    const request = parseInput(scheduleRequestSchema, rawRequest);
    const scheduler = ScheduleService.scheduler;
    assertChannelsConfigured(ScheduleService.config.enabledChannels, request.channels);
    await assertKnownType(request.type);

    const scheduledAt = new Date(request.scheduledAt);
    const past = scheduledAt.getTime() < Date.now() - SCHEDULE_GRACE_MS;
    const existing = request.idempotencyKey
      ? await ScheduleService.findByKey(request.idempotencyKey)
      : undefined;

    if (existing?.status === 'promoted') {
      return {
        scheduledId: existing.id,
        scheduledAt: existing.scheduledAt.toISOString(),
        op: 'completed',
      };
    }
    if (existing && past) {
      await ScheduleService.markCancelled(existing.id);
      return { scheduledId: existing.id, scheduledAt: scheduledAt.toISOString(), op: 'cancelled' };
    }
    if (past) throw new ChaskiError('validation', 'scheduledAt is in the past');

    const scheduledId = existing?.id ?? newId('s');
    const snapshot = await ContactService.upsertFromRecipient(request.recipient);
    const { attachments, overrides } = splitEmailOptions(request.email);
    const storedAttachments = await AttachmentService.store(scheduledId, attachments);
    // The new files overwrite the ones under the same name; the rest of the old ones go.
    const kept = new Set(storedAttachments.map((attachment) => attachment.r2Key));
    const replaced = parseJson<StoredAttachment[]>(existing?.attachments ?? null, []).filter(
      (attachment) => !kept.has(attachment.r2Key),
    );
    const fields = {
      recipientId: request.recipient.id,
      type: request.type,
      channels: request.channels ? JSON.stringify(request.channels) : null,
      payload: JSON.stringify(request.payload),
      contactSnapshot: JSON.stringify(snapshot),
      attachments: storedAttachments.length > 0 ? JSON.stringify(storedAttachments) : null,
      emailOverrides: overrides ? JSON.stringify(overrides) : null,
      pushSilent: request.push?.silent ?? false,
      transactional: request.transactional,
      groupKey: request.groupKey ?? null,
      scheduledAt,
    };

    if (existing) {
      await ScheduleService.db
        .update(scheduledNotifications)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(
            eq(scheduledNotifications.id, existing.id),
            eq(scheduledNotifications.status, 'pending'),
          ),
        );
      await AttachmentService.discard(replaced, { scheduledId });
      await ScheduleService.wake(scheduler, existing.id);
      ScheduleService.log.info('notification rescheduled', { scheduledId });
      return { scheduledId, scheduledAt: scheduledAt.toISOString(), op: 'updated' };
    }

    const created = await ScheduleService.client.scheduledNotifications.create({
      data: {
        id: scheduledId,
        ...fields,
        idempotencyKey: request.idempotencyKey ?? null,
        status: 'pending',
      },
      skipDuplicates: true,
    });
    if (!created && request.idempotencyKey) {
      // A concurrent call created the same key after the lookup above.
      const raced = await ScheduleService.findByKey(request.idempotencyKey);
      if (raced) {
        return {
          scheduledId: raced.id,
          scheduledAt: raced.scheduledAt.toISOString(),
          op: 'updated',
        };
      }
      throw new ChaskiError('conflict', `schedule key '${request.idempotencyKey}' is contended`);
    }

    // The row goes first because the instance reads it when it wakes; if the
    // instance can't be created the row goes too, so nothing sits pending with
    // nothing to fire it.
    try {
      await scheduler.create({ id: scheduledId, params: { scheduledId } });
    } catch (error) {
      await ScheduleService.db
        .delete(scheduledNotifications)
        .where(eq(scheduledNotifications.id, scheduledId));
      throw error;
    }
    ScheduleService.log.info('notification scheduled', { scheduledId });
    return { scheduledId, scheduledAt: scheduledAt.toISOString(), op: 'created' };
  };

  static listPending = async (recipientId?: string): Promise<ScheduledItem[]> => {
    const rows = await ScheduleService.client.scheduledNotifications.findMany({
      where: recipientId ? { status: 'pending', recipientId } : { status: 'pending' },
      orderBy: [{ scheduledAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      recipientId: row.recipientId,
      type: row.type,
      scheduledAt: row.scheduledAt.toISOString(),
      groupKey: row.groupKey ?? undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
    }));
  };

  /** A page of pending schedules, soonest first, for the dashboard. */
  static listPage = async (query: {
    recipientId?: string;
    groupKey?: string;
    page: number;
    limit: number;
  }): Promise<{ schedules: ScheduledItem[]; total: number; page: number; limit: number }> => {
    const where = {
      status: 'pending',
      ...(query.recipientId ? { recipientId: query.recipientId } : {}),
      ...(query.groupKey ? { groupKey: query.groupKey } : {}),
    };
    const [rows, total] = await Promise.all([
      ScheduleService.client.scheduledNotifications.findMany({
        where,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: query.page * query.limit,
        take: query.limit,
      }),
      ScheduleService.client.scheduledNotifications.count({ where }),
    ]);
    return {
      schedules: rows.map((row) => ({
        id: row.id,
        recipientId: row.recipientId,
        type: row.type,
        scheduledAt: row.scheduledAt.toISOString(),
        groupKey: row.groupKey ?? undefined,
        idempotencyKey: row.idempotencyKey ?? undefined,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  };

  // Cancelling and firing both guard on status = 'pending', so whichever
  // flips the row first owns it.
  static cancel = async (rawQuery: unknown): Promise<{ cancelled: number }> => {
    const query = parseInput(cancelScheduledSchema, rawQuery);
    const conditions = [eq(scheduledNotifications.status, 'pending')];
    if (query.id) conditions.push(eq(scheduledNotifications.id, query.id));
    if (query.idempotencyKey) {
      conditions.push(eq(scheduledNotifications.idempotencyKey, query.idempotencyKey));
    }
    if (query.groupKey) conditions.push(eq(scheduledNotifications.groupKey, query.groupKey));

    const cancelled = await ScheduleService.db
      .update(scheduledNotifications)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(...conditions))
      .returning({
        id: scheduledNotifications.id,
        attachments: scheduledNotifications.attachments,
      });
    for (const row of cancelled) {
      await AttachmentService.discard(row.attachments, { scheduledId: row.id });
    }
    return { cancelled: cancelled.length };
  };

  /** Where the scheduler instance stands; null once there is nothing left to send. */
  static workflowTarget = async (
    scheduledId: string,
  ): Promise<{ scheduledAtMs: number; due: boolean } | null> => {
    const row = await ScheduleService.load(scheduledId);
    if (row?.status !== 'pending') return null;
    const scheduledAtMs = row.scheduledAt.getTime();
    return { scheduledAtMs, due: scheduledAtMs <= Date.now() };
  };

  /** Sends a due schedule through the same path as chaski.send(), then retires it. */
  static fire = async (scheduledId: string): Promise<void> => {
    const row = await ScheduleService.load(scheduledId);
    if (row?.status !== 'pending') return;

    await NotificationService.dispatch({
      type: row.type,
      recipientId: row.recipientId,
      snapshot: parseJson<ContactSnapshot>(row.contactSnapshot, {}),
      payload: parseJson<Record<string, unknown>>(row.payload, {}),
      channels: row.channels ? parseJson<Channel[]>(row.channels, []) : undefined,
      transactional: row.transactional,
      emailOverrides: parseJson<{ fromName?: string; replyTo?: string } | null>(
        row.emailOverrides,
        null,
      ),
      pushSilent: row.pushSilent,
      storedAttachments: parseJson<StoredAttachment[]>(row.attachments, []),
      // Without a key of its own, the schedule id keeps a repeated fire from
      // sending twice.
      idempotencyKey: row.idempotencyKey ?? `sched_${row.id}`,
    });
    await ScheduleService.client.scheduledNotifications.update({
      where: { id: row.id },
      data: { status: 'promoted' },
    });
  };

  private static load = (scheduledId: string): Promise<ScheduledRow | undefined> =>
    ScheduleService.db
      .select()
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.id, scheduledId))
      .get();

  private static findByKey = async (idempotencyKey: string) => {
    const rows = await ScheduleService.client.scheduledNotifications.findMany({
      where: { idempotencyKey },
    });
    return rows.find((row) => row.status !== 'cancelled');
  };

  private static markCancelled = async (scheduledId: string) => {
    const cancelled = await ScheduleService.db
      .update(scheduledNotifications)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(scheduledNotifications.id, scheduledId),
          eq(scheduledNotifications.status, 'pending'),
        ),
      )
      .returning({ attachments: scheduledNotifications.attachments });
    for (const row of cancelled) await AttachmentService.discard(row.attachments, { scheduledId });
  };

  // A moved schedule restarts its instance so it sleeps until the new time; an
  // instance that no longer exists is created again.
  private static wake = async (scheduler: Workflow, scheduledId: string): Promise<void> => {
    try {
      await (await scheduler.get(scheduledId)).restart();
    } catch {
      await scheduler.create({ id: scheduledId, params: { scheduledId } });
    }
  };
}
