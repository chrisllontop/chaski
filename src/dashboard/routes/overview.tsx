import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DataBody,
  DataCell,
  DataEmpty,
  DataHead,
  DataHeader,
  DataRow,
  DataTable,
} from '~/components/app/data-table';
import { ChannelLabel, HealthBadge } from '~/components/app/delivery-bits';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Panel, PanelHeader } from '~/components/app/panel';
import { Pill, type Tone } from '~/components/app/pill';
import { SiteHeader } from '~/components/app/site-header';
import { Button } from '~/components/ui/button';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '~/components/ui/chart';
import { Skeleton } from '~/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { api } from '~/lib/api';
import {
  CHANNEL_LABELS,
  formatChange,
  formatDuration,
  formatNumber,
  formatPercent,
  formatUtcDay,
  formatUtcRange,
} from '~/lib/format';
import { languageName, languagesOf, useLocales } from '~/lib/locales';
import type {
  DayOutcome,
  Health,
  Latency,
  Overview,
  Period,
  Timeseries,
  TypeOutcome,
} from '~/lib/types';

const PERIODS: Record<Period, { label: string; days: number }> = {
  '7d': { label: '7 days', days: 7 },
  '30d': { label: '30 days', days: 30 },
  '90d': { label: '90 days', days: 90 },
};

const usePeriodQuery = <T,>(path: string, period: Period) =>
  useQuery({
    queryKey: ['metrics', path, period],
    queryFn: () => api.get<T>(`metrics/${path}?period=${period}`),
  });

// The server reports changes for counts; rate changes are the difference in points.
const pointChange = (current: number | null, previous: number | null) =>
  current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;

// ─── Key figures ───

type Kpi = {
  label: string;
  value: string;
  change: number | null;
  unit: '%' | 'pts';
  /** Whether a rise is good news; volume is neither. */
  goodWhen: 'up' | 'neutral';
  previous: string;
  trend: Array<number | null>;
  trendLabel: string;
  color: string;
};

const changeTone = (kpi: Kpi): Tone => {
  if (kpi.change === null || kpi.change === 0 || kpi.goodWhen === 'neutral') return 'neutral';
  return kpi.change > 0 ? 'success' : 'danger';
};

const Sparkline = ({
  data,
  color,
  label,
}: {
  data: Array<number | null>;
  color: string;
  label: string;
}) => {
  // An SVG id can't hold spaces, and each sparkline needs its own.
  const gradient = `spark-${label.replace(/\W+/g, '-')}`;
  return (
    <ChartContainer
      config={{ value: { label, color } }}
      className="aspect-auto h-9 w-full"
      aria-label={label}
    >
      <AreaChart
        data={data.map((value, index) => ({ index, value }))}
        margin={{ top: 2, bottom: 0, left: 0, right: 0 }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={1.5}
          fill={`url(#${gradient})`}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
};

const KpiStrip = ({ kpis }: { kpis: Kpi[] }) => (
  <Panel className="grid @3xl/main:grid-cols-4 grid-cols-2 divide-x divide-y @3xl/main:divide-y-0">
    {kpis.map((kpi) => (
      <div key={kpi.label} className="flex min-w-0 flex-col gap-2 p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">{kpi.label}</span>
          {kpi.change !== null ? (
            <Pill tone={changeTone(kpi)} className="font-normal">
              {formatChange(kpi.change, kpi.unit)}
            </Pill>
          ) : null}
        </div>
        <div className="font-semibold text-2xl tabular-nums tracking-tight">{kpi.value}</div>
        <div className="text-muted-foreground text-xs">{kpi.previous}</div>
        {/* A trend needs two days with data; one day alone draws a lone spike. */}
        {kpi.trend.filter((value) => value !== null && value !== 0).length >= 2 ? (
          <Sparkline data={kpi.trend} color={kpi.color} label={kpi.trendLabel} />
        ) : (
          <div className="h-9" />
        )}
      </div>
    ))}
  </Panel>
);

const kpisOf = (overview: Overview, series: DayOutcome[]): Kpi[] => {
  const rate = (part: number, whole: number) => (whole === 0 ? null : (part / whole) * 100);
  return [
    {
      label: 'Notifications',
      value: formatNumber(overview.notifications),
      change: overview.change.notifications,
      unit: '%',
      goodWhen: 'neutral',
      previous: `${formatNumber(overview.previous.notifications)} the period before`,
      trend: series.map((day) => day.notifications),
      trendLabel: 'Notifications per day',
      color: 'var(--muted-foreground)',
    },
    {
      label: 'Sent',
      value: formatNumber(overview.sent),
      change: overview.change.sent,
      unit: '%',
      goodWhen: 'up',
      previous: `${formatNumber(overview.previous.sent)} the period before`,
      trend: series.map((day) => day.sent),
      trendLabel: 'Sent per day',
      color: 'var(--chart-1)',
    },
    {
      label: 'Success rate',
      value: formatPercent(overview.successRate),
      change: pointChange(overview.successRate, overview.previous.successRate),
      unit: 'pts',
      goodWhen: 'up',
      previous: `${formatPercent(overview.previous.successRate)} the period before`,
      trend: series.map((day) => rate(day.sent, day.sent + day.failed)),
      trendLabel: 'Success rate per day',
      color: 'var(--chart-1)',
    },
    {
      label: 'Open rate',
      value: formatPercent(overview.openRate),
      change: pointChange(overview.openRate, overview.previous.openRate),
      unit: 'pts',
      goodWhen: 'up',
      previous: `${formatPercent(overview.previous.openRate)} the period before`,
      trend: series.map((day) => day.opened),
      trendLabel: 'Opens per day',
      color: 'var(--chart-2)',
    },
  ];
};

// ─── Deliveries per day ───

const OUTCOMES = {
  sent: { label: 'Sent', color: 'var(--chart-1)' },
  failed: { label: 'Failed', color: 'var(--chart-5)' },
  skipped: { label: 'Skipped', color: 'var(--chart-3)' },
  opened: { label: 'Opened', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const Legend = ({ items }: { items: Array<{ label: string; color: string; value: string }> }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
    {items.map((item) => (
      <span key={item.label} className="flex items-center gap-1.5 text-xs">
        <span className="size-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
        <span className="text-muted-foreground">{item.label}</span>
        <span className="font-medium tabular-nums">{item.value}</span>
      </span>
    ))}
  </div>
);

const DailyOutcomes = ({ overview, series }: { overview: Overview; series: DayOutcome[] }) => (
  <Panel>
    <PanelHeader
      title="Deliveries per day"
      description="By the UTC day of each delivery’s latest change"
      actions={
        <Legend
          items={[
            { ...OUTCOMES.sent, value: formatNumber(overview.sent) },
            { ...OUTCOMES.failed, value: formatNumber(overview.failed + overview.dead) },
            { ...OUTCOMES.skipped, value: formatNumber(overview.skipped) },
            { ...OUTCOMES.opened, value: formatNumber(overview.opened) },
          ]}
        />
      }
    />
    <div className="px-2 pt-4 pb-2 sm:px-4">
      <ChartContainer config={OUTCOMES} className="aspect-auto h-[240px] w-full">
        <ComposedChart data={series} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={(value: string) => formatUtcDay(value)}
          />
          <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={
              <ChartTooltipContent
                className="w-[160px]"
                labelFormatter={(value) => formatUtcDay(String(value))}
              />
            }
          />
          <Bar
            dataKey="sent"
            stackId="outcome"
            fill="var(--color-sent)"
            maxBarSize={28}
            animationDuration={600}
          />
          <Bar
            dataKey="failed"
            stackId="outcome"
            fill="var(--color-failed)"
            maxBarSize={28}
            animationDuration={600}
          />
          <Bar
            dataKey="skipped"
            stackId="outcome"
            fill="var(--color-skipped)"
            radius={[3, 3, 0, 0]}
            maxBarSize={28}
            animationDuration={600}
          />
          {overview.opened > 0 ? (
            <Line
              dataKey="opened"
              type="monotone"
              stroke="var(--color-opened)"
              strokeWidth={2}
              dot={false}
              animationDuration={600}
            />
          ) : null}
        </ComposedChart>
      </ChartContainer>
    </div>
  </Panel>
);

// ─── Latency ───

const LATENCY_SERIES = {
  p50: { label: 'p50', color: 'var(--chart-2)' },
  p95: { label: 'p95', color: 'var(--chart-4)' },
} satisfies ChartConfig;

const Figure = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <span className="whitespace-nowrap text-muted-foreground text-xs">{label}</span>
    <span className="whitespace-nowrap font-semibold text-lg tabular-nums tracking-tight">
      {value}
    </span>
  </div>
);

const LatencyPanel = ({ latency }: { latency: Latency }) => (
  <Panel className="flex flex-col">
    <PanelHeader
      title="Latency"
      description="From the send to the provider accepting it, retries included"
    />
    <div className="flex flex-wrap gap-x-8 gap-y-3 px-4 pt-4">
      <Figure label="To deliver · p50" value={formatDuration(latency.overall.toDeliver.p50)} />
      <Figure label="To deliver · p95" value={formatDuration(latency.overall.toDeliver.p95)} />
      <Figure label="Provider · p95" value={formatDuration(latency.overall.provider.p95)} />
      <Figure label="Sent" value={formatNumber(latency.overall.count)} />
    </div>
    <div className="px-2 pt-2 sm:px-4">
      <ChartContainer config={LATENCY_SERIES} className="aspect-auto h-[160px] w-full">
        <LineChart data={latency.series} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={(value: string) => formatUtcDay(value)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(value: number) => formatDuration(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="w-[160px]"
                labelFormatter={(value) => formatUtcDay(String(value))}
                formatter={(value, name, item) => (
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: item.color }}
                      />
                      {name}
                    </span>
                    <span className="font-medium font-mono text-foreground tabular-nums">
                      {formatDuration(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          {(['p50', 'p95'] as const).map((key) => (
            <Line
              key={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              animationDuration={600}
              // Days without sends are gaps, so a lone day still shows as a point.
              dot={{ r: 2.5, strokeWidth: 0, fill: `var(--color-${key})` }}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
    <DataTable bare className="mt-2 border-t">
      <DataHeader>
        <DataRow>
          <DataHead>Channel</DataHead>
          <DataHead numeric>Sent</DataHead>
          <DataHead numeric>To deliver p50</DataHead>
          <DataHead numeric>p95</DataHead>
          <DataHead numeric>Provider p50</DataHead>
          <DataHead numeric>p95</DataHead>
        </DataRow>
      </DataHeader>
      <DataBody>
        {latency.channels.length === 0 ? (
          <DataEmpty colSpan={6}>Nothing was sent in this period.</DataEmpty>
        ) : (
          latency.channels.map((row) => (
            <DataRow key={row.channel}>
              <DataCell>
                <ChannelLabel channel={row.channel} />
              </DataCell>
              <DataCell numeric>{formatNumber(row.count)}</DataCell>
              <DataCell numeric>{formatDuration(row.toDeliver.p50)}</DataCell>
              <DataCell numeric>{formatDuration(row.toDeliver.p95)}</DataCell>
              <DataCell numeric>{formatDuration(row.provider.p50)}</DataCell>
              <DataCell numeric>{formatDuration(row.provider.p95)}</DataCell>
            </DataRow>
          ))
        )}
      </DataBody>
    </DataTable>
  </Panel>
);

// ─── Health ───

const HEALTH_ORDER: Health[] = ['blocked', 'at_risk', 'healthy', 'paused'];
const HEALTH_BAR: Record<Health, { label: string; className: string }> = {
  blocked: { label: 'Blocked', className: 'bg-destructive' },
  at_risk: { label: 'At risk', className: 'bg-chart-4' },
  healthy: { label: 'Healthy', className: 'bg-success' },
  paused: { label: 'Paused', className: 'bg-muted-foreground/40' },
};

const HealthPanel = ({ types }: { types: TypeOutcome[] }) => {
  const counts = Object.fromEntries(
    HEALTH_ORDER.map((health) => [health, types.filter((row) => row.health === health).length]),
  ) as Record<Health, number>;
  const attention = types
    .filter((row) => row.health === 'blocked' || row.health === 'at_risk')
    .sort((a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health));
  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Health" description="Each type on each channel, over the period" />
      <div className="space-y-3 p-4">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {HEALTH_ORDER.map((health) =>
            counts[health] > 0 ? (
              <div
                key={health}
                className={HEALTH_BAR[health].className}
                style={{ width: `${(counts[health] / types.length) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
          {HEALTH_ORDER.map((health) => (
            <div key={health} className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <span className={cn('size-2 rounded-full', HEALTH_BAR[health].className)} />
                {HEALTH_BAR[health].label}
              </dt>
              <dd className="font-medium tabular-nums">{formatNumber(counts[health])}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex-1 border-t">
        {types.length === 0 ? (
          <p className="p-4 text-muted-foreground text-sm">No deliveries in this period.</p>
        ) : attention.length === 0 ? (
          <p className="p-4 text-muted-foreground text-sm">
            Every type that sent in this period is healthy or paused.
          </p>
        ) : (
          <ul className="divide-y">
            {attention.map((row) => (
              <li key={`${row.type}:${row.channel}`}>
                <Link
                  to="/deliveries"
                  search={{ type: row.type, channel: row.channel }}
                  className="group flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs">{row.type}</div>
                    <div className="text-muted-foreground text-xs">
                      <ChannelLabel channel={row.channel} /> · {formatNumber(row.failed)} of{' '}
                      {formatNumber(row.volume)} failed
                    </div>
                  </div>
                  <HealthBadge health={row.health} />
                  <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
};

// ─── By type and channel ───

const RateBar = ({ value }: { value: number | null }) => (
  <div className="flex items-center justify-end gap-2">
    <span className="tabular-nums">{formatPercent(value)}</span>
    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
      {value !== null ? (
        <div
          className={cn(
            'h-full',
            value >= 95 ? 'bg-success' : value >= 75 ? 'bg-chart-4' : 'bg-destructive',
          )}
          style={{ width: `${value}%` }}
        />
      ) : null}
    </div>
  </div>
);

const TypeTable = ({ types }: { types: TypeOutcome[] }) => (
  <Panel>
    <PanelHeader title="By type and channel" description="Busiest first" />
    <DataTable bare>
      <DataHeader>
        <DataRow>
          <DataHead>Type</DataHead>
          <DataHead>Channel</DataHead>
          <DataHead>Health</DataHead>
          <DataHead numeric>Volume</DataHead>
          <DataHead numeric>Sent</DataHead>
          <DataHead numeric>Failed</DataHead>
          <DataHead numeric>Skipped</DataHead>
          <DataHead numeric>Opened</DataHead>
          <DataHead numeric>Success rate</DataHead>
        </DataRow>
      </DataHeader>
      <DataBody>
        {types.length === 0 ? (
          <DataEmpty colSpan={9}>No deliveries in this period.</DataEmpty>
        ) : (
          types.map((row) => (
            <DataRow key={`${row.type}:${row.channel}`}>
              <DataCell className="font-mono text-xs">{row.type}</DataCell>
              <DataCell>
                <ChannelLabel channel={row.channel} />
              </DataCell>
              <DataCell>
                <HealthBadge health={row.health} />
              </DataCell>
              <DataCell numeric>{formatNumber(row.volume)}</DataCell>
              <DataCell numeric>{formatNumber(row.sent)}</DataCell>
              <DataCell numeric className={row.failed > 0 ? 'text-destructive' : undefined}>
                {formatNumber(row.failed)}
              </DataCell>
              <DataCell numeric className="text-muted-foreground">
                {formatNumber(row.skipped)}
              </DataCell>
              <DataCell numeric className="text-muted-foreground">
                {row.channel === 'email' ? formatNumber(row.opened) : '–'}
              </DataCell>
              <DataCell>
                <RateBar value={row.successRate} />
              </DataCell>
            </DataRow>
          ))
        )}
      </DataBody>
    </DataTable>
  </Panel>
);

// ─── Errors, skips, schedules ───

const CountList = ({
  title,
  description,
  rows,
  empty,
  barClass,
  footer,
}: {
  title: string;
  description: string;
  rows: Array<{ key: string; count: number }>;
  empty: string;
  barClass: string;
  footer?: ReactNode;
}) => {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <Panel className="flex flex-col">
      <PanelHeader title={title} description={description} />
      {rows.length === 0 ? (
        <p className="flex-1 p-4 text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="flex-1 space-y-3 p-4">
          {rows.map((row) => (
            <li key={row.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <code className="min-w-0 break-words font-mono text-xs">{row.key}</code>
                <span className="font-medium tabular-nums">{formatNumber(row.count)}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full', barClass)}
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {footer ? <div className="border-t p-2">{footer}</div> : null}
    </Panel>
  );
};

const ViewLink = ({ to, children }: { to: '/schedules' | '/templates'; children: ReactNode }) => (
  <Button variant="ghost" size="sm" className="w-full justify-between" asChild>
    <Link to={to}>
      {children} <ArrowRight />
    </Link>
  </Button>
);

const ScheduledPanel = ({ pending }: { pending: number }) => (
  <Panel className="flex flex-col">
    <PanelHeader title="Scheduled" description="Waiting for their time to send" />
    <div className="flex flex-1 items-baseline gap-2 p-4">
      <span className="font-semibold text-4xl tabular-nums tracking-tight">
        {formatNumber(pending)}
      </span>
      <span className="text-muted-foreground text-sm">pending</span>
    </div>
    <div className="border-t p-2">
      <ViewLink to="/schedules">View schedules</ViewLink>
    </div>
  </Panel>
);

// ─── Page ───

export const OverviewPage = () => {
  const [period, setPeriod] = useState<Period>('30d');
  const overview = usePeriodQuery<Overview>('overview', period);
  const timeseries = usePeriodQuery<Timeseries>('timeseries', period);
  const types = usePeriodQuery<{ types: TypeOutcome[] }>('types', period);
  const latency = usePeriodQuery<Latency>('latency', period);
  const error = overview.error ?? timeseries.error ?? types.error ?? latency.error;
  const languages = languagesOf(useLocales().data);

  return (
    <>
      <SiteHeader />
      <div className="@container/main mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-6 pt-6 pb-10">
        <PageHeader
          title="Overview"
          description={overview.data ? formatUtcRange(overview.data.from, overview.data.to) : ' '}
          actions={
            <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)}>
              <TabsList className="h-8">
                {(Object.keys(PERIODS) as Period[]).map((key) => (
                  <TabsTrigger key={key} value={key} className="px-2.5 text-xs">
                    {PERIODS[key].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
        />
        {error ? <ErrorAlert error={error} /> : null}
        {overview.data && timeseries.data && types.data && latency.data ? (
          <>
            <KpiStrip kpis={kpisOf(overview.data, timeseries.data.series)} />
            <DailyOutcomes overview={overview.data} series={timeseries.data.series} />
            <div className="grid @5xl/main:grid-cols-3 gap-4">
              <div className="@5xl/main:col-span-2">
                <LatencyPanel latency={latency.data} />
              </div>
              <HealthPanel types={types.data.types} />
            </div>
            <TypeTable types={types.data.types} />
            <div
              className={cn(
                'grid gap-4',
                languages ? '@3xl/main:grid-cols-2 @5xl/main:grid-cols-4' : '@3xl/main:grid-cols-3',
              )}
            >
              <CountList
                title="Top error codes"
                description="Failed and dead deliveries"
                rows={overview.data.topErrorCodes.map((r) => ({
                  key: r.errorCode,
                  count: r.count,
                }))}
                empty="No failures in this period."
                barClass="bg-destructive/70"
              />
              <CountList
                title="Skip reasons"
                description="Deliveries that never went out"
                rows={overview.data.skipReasons.map((r) => ({ key: r.skipReason, count: r.count }))}
                empty="Nothing was skipped in this period."
                barClass="bg-muted-foreground/50"
              />
              <ScheduledPanel pending={overview.data.scheduledPending} />
              {languages ? (
                <CountList
                  title="Language fallbacks"
                  description="Sent in the default language"
                  rows={overview.data.languageFallbacks.rows.slice(0, 5).map((r) => ({
                    key: `${r.type} · ${CHANNEL_LABELS[r.channel].toLowerCase()} · ${r.requestedLocale}`,
                    count: r.count,
                  }))}
                  empty={`Nothing fell back to ${languageName(languages.default)} in this period.`}
                  barClass="bg-warning/70"
                  footer={<ViewLink to="/templates">View templates</ViewLink>}
                />
              ) : null}
            </div>
          </>
        ) : error ? null : (
          <div className="grid gap-4">
            <Skeleton className="h-36" />
            <Skeleton className="h-80" />
            <Skeleton className="h-72" />
          </div>
        )}
      </div>
    </>
  );
};
