import { and, eq, gte, inArray, isNotNull, lt, type SQL, sql } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { deliveries, notifications, scheduledNotifications } from '../db/schema';
import { BaseService } from './base.service';

export const METRIC_PERIODS = ['7d', '30d', '90d'] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<MetricPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

// Windows are half-open, [from, to), so adjacent periods neither overlap nor
// leave a gap. workerd freezes the clock between I/O, so `to` moves one
// millisecond past now to include rows stamped in this very instant.
const windowFor = (period: MetricPeriod) => {
  const now = Date.now();
  const durationMs = PERIOD_DAYS[period] * DAY_MS;
  return {
    from: new Date(now - durationMs),
    to: new Date(now + 1),
    previousFrom: new Date(now - 2 * durationMs),
  };
};

// Percentages with two decimals; null when there is nothing to divide by.
const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 10_000) / 100;

const change = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

const utcDays = (from: Date, to: Date): string[] => {
  const days: string[] = [];
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let day = first; day < to.getTime(); day += DAY_MS) {
    days.push(new Date(day).toISOString().slice(0, 10));
  }
  return days;
};

export type Health = 'healthy' | 'at_risk' | 'blocked' | 'paused';

/**
 * How a type is doing on one channel over the period: blocked once failures reach a
 * quarter of the volume, at risk on any failure or a backlog, paused when all skipped.
 */
export const healthOf = (stats: {
  volume: number;
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
}): Health => {
  if (stats.failed > 0 && stats.failed / stats.volume >= 0.25) return 'blocked';
  if (stats.failed > 0 || stats.pending > stats.sent) return 'at_risk';
  if (stats.skipped === stats.volume) return 'paused';
  return 'healthy';
};

type LatencyRow = {
  key: string;
  count: number;
  deliverP50: number | null;
  deliverP95: number | null;
  providerP50: number | null;
  providerP95: number | null;
};

// Nearest-rank percentile: the value at rank ceil(n × p / 100), in integer
// arithmetic because D1 may lack SQLite's math functions.
const rankOf = (n: string, p: number) => sql.raw(`(${n} * ${p} + 99) / 100`);

const latencyStats = (row: LatencyRow) => ({
  count: Number(row.count),
  toDeliver: { p50: row.deliverP50, p95: row.deliverP95 },
  provider: { p50: row.providerP50, p95: row.providerP95 },
});

export class MetricsService extends BaseService {
  protected static override name = 'metrics';

  static overview = async (period: MetricPeriod) => {
    const { from, to, previousFrom } = windowFor(period);
    const [current, previous, topErrorCodes, skipReasons, scheduledPending] = await Promise.all([
      MetricsService.totals(from, to),
      MetricsService.totals(previousFrom, from),
      MetricsService.topBy('errorCode', from, to),
      MetricsService.topBy('skipReason', from, to),
      MetricsService.scheduledPending(),
    ]);
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      ...current,
      previous,
      change: {
        notifications: change(current.notifications, previous.notifications),
        sent: change(current.sent, previous.sent),
        failed: change(current.failed + current.dead, previous.failed + previous.dead),
        opened: change(current.opened, previous.opened),
      },
      topErrorCodes,
      skipReasons,
      scheduledPending,
    };
  };

  /** Daily outcomes in UTC days, with empty days filled in. */
  static timeseries = async (period: MetricPeriod) => {
    const { from, to } = windowFor(period);
    const db = MetricsService.db;
    const day = (column: typeof deliveries.updatedAt | typeof deliveries.openedAt) =>
      sql<string>`date(${column} / 1000, 'unixepoch')`;
    const [statusRows, openedRows] = await Promise.all([
      db
        .select({
          day: day(deliveries.updatedAt),
          status: deliveries.status,
          count: sql<number>`count(*)`,
        })
        .from(deliveries)
        .where(and(gte(deliveries.updatedAt, from), lt(deliveries.updatedAt, to)))
        .groupBy(day(deliveries.updatedAt), deliveries.status)
        .all(),
      db
        .select({ day: day(deliveries.openedAt), count: sql<number>`count(*)` })
        .from(deliveries)
        .where(and(gte(deliveries.openedAt, from), lt(deliveries.openedAt, to)))
        .groupBy(day(deliveries.openedAt))
        .all(),
    ]);

    const series = new Map(
      utcDays(from, to).map((date) => [date, { date, sent: 0, failed: 0, skipped: 0, opened: 0 }]),
    );
    for (const row of statusRows) {
      const bucket = series.get(row.day);
      if (!bucket) continue;
      if (row.status === 'sent') bucket.sent += Number(row.count);
      else if (row.status === 'failed' || row.status === 'dead') bucket.failed += Number(row.count);
      else if (row.status === 'skipped') bucket.skipped += Number(row.count);
    }
    for (const row of openedRows) {
      const bucket = series.get(row.day);
      if (bucket) bucket.opened += Number(row.count);
    }
    return { period, from: from.toISOString(), series: [...series.values()] };
  };

  /** Outcomes per notification type and channel, busiest first. */
  static byType = async (period: MetricPeriod) => {
    const { from, to } = windowFor(period);
    const count = (status: string[]) =>
      sql<number>`sum(case when ${inArray(deliveries.status, status)} then 1 else 0 end)`;
    const rows = await MetricsService.db
      .select({
        type: notifications.type,
        channel: deliveries.channel,
        volume: sql<number>`count(*)`,
        sent: count(['sent']),
        failed: count(['failed', 'dead']),
        pending: count(['pending']),
        skipped: count(['skipped']),
        // Opens count by when they happened, the same window the overview uses.
        opened: sql<number>`sum(case when ${deliveries.openedAt} >= ${sql.param(from, deliveries.openedAt)} and ${deliveries.openedAt} < ${sql.param(to, deliveries.openedAt)} then 1 else 0 end)`,
      })
      .from(deliveries)
      .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
      .where(and(gte(deliveries.updatedAt, from), lt(deliveries.updatedAt, to)))
      .groupBy(notifications.type, deliveries.channel)
      .orderBy(sql`count(*) desc`)
      .all();
    return {
      period,
      from: from.toISOString(),
      types: rows.map((row) => {
        const stats = {
          volume: Number(row.volume),
          sent: Number(row.sent),
          failed: Number(row.failed),
          pending: Number(row.pending),
          skipped: Number(row.skipped),
        };
        return {
          type: row.type,
          channel: row.channel as Channel,
          ...stats,
          opened: Number(row.opened),
          successRate: percent(stats.sent, stats.sent + stats.failed),
          health: healthOf(stats),
        };
      }),
    };
  };

  /**
   * Percentiles of time to deliver (notification created to delivery sent, retries
   * included) and of the provider's time on the sending attempt, over sent deliveries.
   */
  static latency = async (period: MetricPeriod) => {
    const { from, to } = windowFor(period);
    const [overall, channels, days] = await Promise.all([
      MetricsService.latencyBy(sql`'all'`, from, to),
      MetricsService.latencyBy(sql`d.channel`, from, to),
      MetricsService.latencyBy(sql`date(d.sent_at / 1000, 'unixepoch')`, from, to),
    ]);
    const byDay = new Map(days.map((row) => [row.key, row]));
    return {
      period,
      from: from.toISOString(),
      overall: latencyStats(
        overall[0] ?? {
          key: 'all',
          count: 0,
          deliverP50: null,
          deliverP95: null,
          providerP50: null,
          providerP95: null,
        },
      ),
      channels: channels.map((row) => ({ channel: row.key as Channel, ...latencyStats(row) })),
      series: utcDays(from, to).map((date) => {
        const row = byDay.get(date);
        return {
          date,
          count: Number(row?.count ?? 0),
          p50: row?.deliverP50 ?? null,
          p95: row?.deliverP95 ?? null,
        };
      }),
    };
  };

  private static latencyBy = async (key: SQL, from: Date, to: Date) => {
    // Provider times sort nulls last, so the ranks below the non-null count
    // only ever land on measured attempts.
    return MetricsService.db.all<LatencyRow>(sql`
      WITH samples AS (
        SELECT ${key} AS key, d.sent_at - n.created_at AS deliver, d.provider_ms AS provider
        FROM deliveries d JOIN notifications n ON n.id = d.notification_id
        WHERE d.status = 'sent'
          AND d.sent_at >= ${from.getTime()} AND d.sent_at < ${to.getTime()}
      ),
      ranked AS (
        SELECT key, deliver, provider,
          row_number() OVER (PARTITION BY key ORDER BY deliver) AS deliver_rank,
          row_number() OVER (PARTITION BY key ORDER BY provider IS NULL, provider) AS provider_rank,
          count(*) OVER (PARTITION BY key) AS n,
          count(provider) OVER (PARTITION BY key) AS measured
        FROM samples
      )
      SELECT key, max(n) AS count,
        max(CASE WHEN deliver_rank = ${rankOf('n', 50)} THEN deliver END) AS deliverP50,
        max(CASE WHEN deliver_rank = ${rankOf('n', 95)} THEN deliver END) AS deliverP95,
        max(CASE WHEN provider_rank = ${rankOf('measured', 50)} THEN provider END) AS providerP50,
        max(CASE WHEN provider_rank = ${rankOf('measured', 95)} THEN provider END) AS providerP95
      FROM ranked
      GROUP BY key
      ORDER BY count DESC
    `);
  };

  private static totals = async (from: Date, to: Date) => {
    const db = MetricsService.db;
    const inWindow = and(gte(deliveries.updatedAt, from), lt(deliveries.updatedAt, to));
    const [statusRows, channelRows, notificationCount, openedCount, emailsSent] = await Promise.all(
      [
        db
          .select({ key: deliveries.status, count: sql<number>`count(*)` })
          .from(deliveries)
          .where(inWindow)
          .groupBy(deliveries.status)
          .all(),
        db
          .select({ key: deliveries.channel, count: sql<number>`count(*)` })
          .from(deliveries)
          .where(inWindow)
          .groupBy(deliveries.channel)
          .all(),
        db
          .select({ count: sql<number>`count(*)` })
          .from(notifications)
          .where(and(gte(notifications.createdAt, from), lt(notifications.createdAt, to)))
          .get(),
        // Opens count by the first open, so a delivery opened again later never
        // counts twice.
        db
          .select({ count: sql<number>`count(*)` })
          .from(deliveries)
          .where(and(gte(deliveries.openedAt, from), lt(deliveries.openedAt, to)))
          .get(),
        // Only email tracks opens, so the open rate is over sent emails.
        db
          .select({ count: sql<number>`count(*)` })
          .from(deliveries)
          .where(and(inWindow, eq(deliveries.channel, 'email'), eq(deliveries.status, 'sent')))
          .get(),
      ],
    );
    const byStatus = Object.fromEntries(statusRows.map((row) => [row.key, Number(row.count)]));
    const byChannel = Object.fromEntries(channelRows.map((row) => [row.key, Number(row.count)]));
    const sent = byStatus.sent ?? 0;
    const failed = byStatus.failed ?? 0;
    const dead = byStatus.dead ?? 0;
    const opened = Number(openedCount?.count ?? 0);
    return {
      notifications: Number(notificationCount?.count ?? 0),
      deliveries: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      byStatus,
      byChannel,
      sent,
      failed,
      dead,
      pending: byStatus.pending ?? 0,
      skipped: byStatus.skipped ?? 0,
      opened,
      successRate: percent(sent, sent + failed + dead),
      openRate: percent(opened, Number(emailsSent?.count ?? 0)),
    };
  };

  // A pending delivery that is retrying carries an error code too; only the
  // ones that ended count, so the list adds up to failed plus dead.
  private static topBy = async (field: 'errorCode' | 'skipReason', from: Date, to: Date) => {
    const column = deliveries[field];
    const ended = field === 'errorCode' ? (['failed', 'dead'] as const) : (['skipped'] as const);
    const rows = await MetricsService.db
      .select({ key: column, count: sql<number>`count(*)` })
      .from(deliveries)
      .where(
        and(
          gte(deliveries.updatedAt, from),
          lt(deliveries.updatedAt, to),
          isNotNull(column),
          inArray(deliveries.status, [...ended]),
        ),
      )
      .groupBy(column)
      .orderBy(sql`count(*) desc`)
      .limit(5)
      .all();
    return rows.map((row) => ({ [field]: row.key ?? '', count: Number(row.count) }));
  };

  private static scheduledPending = async () => {
    const row = await MetricsService.db
      .select({ count: sql<number>`count(*)` })
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.status, 'pending'))
      .get();
    return Number(row?.count ?? 0);
  };
}
