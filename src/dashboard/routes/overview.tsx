import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChannelLabel, HealthBadge } from '~/components/app/delivery-bits';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { SiteHeader } from '~/components/app/site-header';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '~/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Skeleton } from '~/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import {
  formatChange,
  formatDuration,
  formatNumber,
  formatPercent,
  formatUtcDay,
  formatUtcRange,
} from '~/lib/format';
import type { Latency, Overview, Period, Timeseries, TypeOutcome } from '~/lib/types';

const PERIODS: Record<Period, { label: string; days: number }> = {
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
};

const usePeriodQuery = <T,>(path: string, period: Period) =>
  useQuery({
    queryKey: ['metrics', path, period],
    queryFn: () => api.get<T>(`metrics/${path}?period=${period}`),
  });

// ─── Metric cards ───

const Trend = ({ value, unit }: { value: number | null; unit: '%' | 'pts' }) => {
  const text = formatChange(value, unit);
  if (!text || value === null) return null;
  const Icon = value < 0 ? TrendingDown : TrendingUp;
  return (
    <Badge variant="outline">
      <Icon />
      {text}
    </Badge>
  );
};

const MetricCard = ({
  label,
  value,
  change,
  unit,
  summary,
  previous,
}: {
  label: string;
  value: string;
  change: number | null;
  unit: '%' | 'pts';
  summary: string;
  previous: string;
}) => (
  <Card className="@container/card">
    <CardHeader>
      <CardDescription>{label}</CardDescription>
      <CardTitle className="font-semibold text-3xl tabular-nums">{value}</CardTitle>
      <CardAction>
        <Trend value={change} unit={unit} />
      </CardAction>
    </CardHeader>
    <CardFooter className="flex-col items-start gap-1 text-sm">
      <div className="font-medium">{summary}</div>
      <div className="text-muted-foreground">{previous}</div>
    </CardFooter>
  </Card>
);

// The server reports changes for counts; rate changes are the difference in points.
const pointChange = (current: number | null, previous: number | null) =>
  current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;

const MetricCards = ({ overview, days }: { overview: Overview; days: number }) => {
  const direction = (change: number | null) =>
    change === null || change >= 0
      ? `Up from the previous ${days} days`
      : `Down from the previous ${days} days`;
  return (
    <div className="grid @5xl/main:grid-cols-4 @xl/main:grid-cols-2 grid-cols-1 gap-4">
      <MetricCard
        label="Notifications"
        value={formatNumber(overview.notifications)}
        change={overview.change.notifications}
        unit="%"
        summary={direction(overview.change.notifications)}
        previous={`${formatNumber(overview.previous.notifications)} in the previous period`}
      />
      <MetricCard
        label="Sent"
        value={formatNumber(overview.sent)}
        change={overview.change.sent}
        unit="%"
        summary={direction(overview.change.sent)}
        previous={`${formatNumber(overview.previous.sent)} in the previous period`}
      />
      <MetricCard
        label="Success rate"
        value={formatPercent(overview.successRate)}
        change={pointChange(overview.successRate, overview.previous.successRate)}
        unit="pts"
        summary="Sent out of sent, failed and dead"
        previous={`${formatPercent(overview.previous.successRate)} in the previous period`}
      />
      <MetricCard
        label="Open rate"
        value={formatPercent(overview.openRate)}
        change={pointChange(overview.openRate, overview.previous.openRate)}
        unit="pts"
        summary="Opened out of sent emails"
        previous={`${formatPercent(overview.previous.openRate)} in the previous period`}
      />
    </div>
  );
};

// ─── Daily chart ───

const SERIES = {
  sent: { label: 'Sent', color: 'var(--chart-2)' },
  opened: { label: 'Opened', color: 'var(--chart-1)' },
  failed: { label: 'Failed', color: 'var(--chart-5)' },
  skipped: { label: 'Skipped', color: 'var(--chart-3)' },
} satisfies ChartConfig;

type Series = keyof typeof SERIES;

const DailyChart = ({ overview, timeseries }: { overview: Overview; timeseries: Timeseries }) => {
  const [series, setSeries] = useState<Series>('sent');
  const totals: Record<Series, number> = {
    sent: overview.sent,
    opened: overview.opened,
    failed: overview.failed + overview.dead,
    skipped: overview.skipped,
  };
  return (
    <Card className="py-0">
      <CardHeader className="flex flex-col items-stretch border-b p-0! sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:py-6">
          <CardTitle>Deliveries per day</CardTitle>
          <CardDescription>
            Outcomes for the period, by the UTC day they were last updated
          </CardDescription>
        </div>
        <div className="flex">
          {(Object.keys(SERIES) as Series[]).map((key) => (
            <button
              key={key}
              type="button"
              data-active={series === key}
              className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-t-0 sm:border-l sm:px-8 sm:py-6"
              onClick={() => setSeries(key)}
            >
              <span className="text-muted-foreground text-xs">{SERIES[key].label}</span>
              <span className="font-bold text-lg leading-none tabular-nums sm:text-3xl">
                {formatNumber(totals[key])}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={SERIES} className="aspect-auto h-[250px] w-full">
          <BarChart data={timeseries.series} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value: string) => formatUtcDay(value)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  nameKey={series}
                  labelFormatter={(value) => formatUtcDay(String(value))}
                />
              }
            />
            <Bar dataKey={series} fill={`var(--color-${series})`} radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

// ─── Latency ───

const LATENCY_SERIES = {
  p50: { label: 'p50', color: 'var(--chart-2)' },
  p95: { label: 'p95', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const LatencyFigure = ({ label, value }: { label: string; value: number | null }) => (
  <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 even:border-l sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
    <span className="whitespace-nowrap text-muted-foreground text-xs">{label}</span>
    <span className="whitespace-nowrap font-bold text-lg leading-none tabular-nums sm:text-3xl">
      {formatDuration(value)}
    </span>
  </div>
);

const LatencyCard = ({ latency }: { latency: Latency }) => (
  <Card className="py-0">
    <CardHeader className="flex flex-col items-stretch border-b p-0! sm:flex-row">
      <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:py-6">
        <CardTitle>Latency</CardTitle>
        <CardDescription>
          Time to deliver runs from the send to the provider accepting it, retries included
        </CardDescription>
      </div>
      <div className="flex">
        <LatencyFigure label="To deliver · p50" value={latency.overall.toDeliver.p50} />
        <LatencyFigure label="To deliver · p95" value={latency.overall.toDeliver.p95} />
        <LatencyFigure label="Provider · p95" value={latency.overall.provider.p95} />
      </div>
    </CardHeader>
    <CardContent className="flex flex-col gap-6 px-2 py-6 sm:px-6">
      <ChartContainer config={LATENCY_SERIES} className="aspect-auto h-[220px] w-full">
        <LineChart data={latency.series} margin={{ left: 4, right: 12 }}>
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
              // Days without sends are gaps, so a lone day still shows as a point.
              dot={{ r: 2.5, strokeWidth: 0, fill: `var(--color-${key})` }}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">To deliver · p50</TableHead>
            <TableHead className="text-right">To deliver · p95</TableHead>
            <TableHead className="text-right">Provider · p50</TableHead>
            <TableHead className="text-right">Provider · p95</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {latency.channels.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                Nothing was sent in this period.
              </TableCell>
            </TableRow>
          ) : (
            latency.channels.map((row) => (
              <TableRow key={row.channel}>
                <TableCell>
                  <ChannelLabel channel={row.channel} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.count)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(row.toDeliver.p50)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(row.toDeliver.p95)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(row.provider.p50)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(row.provider.p95)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

// ─── By type and channel ───

const TypeTable = ({ types }: { types: TypeOutcome[] }) => (
  <Card>
    <CardHeader>
      <CardTitle>By type and channel</CardTitle>
      <CardDescription>Busiest first</CardDescription>
    </CardHeader>
    <CardContent className="px-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Type</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Health</TableHead>
            <TableHead className="text-right">Volume</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead className="text-right">Skipped</TableHead>
            <TableHead className="text-right">Opened</TableHead>
            <TableHead className="pr-6 text-right">Success rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                No deliveries in this period.
              </TableCell>
            </TableRow>
          ) : (
            types.map((row) => (
              <TableRow key={`${row.type}:${row.channel}`}>
                <TableCell className="pl-6 font-medium">{row.type}</TableCell>
                <TableCell>
                  <ChannelLabel channel={row.channel} />
                </TableCell>
                <TableCell>
                  <HealthBadge health={row.health} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.volume)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.sent)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.failed)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.skipped)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.channel === 'email' ? formatNumber(row.opened) : '–'}
                </TableCell>
                <TableCell className="pr-6 text-right tabular-nums">
                  {formatPercent(row.successRate)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

const CountList = ({
  title,
  description,
  rows,
  empty,
}: {
  title: string;
  description: string;
  rows: Array<{ key: string; count: number }>;
  empty: string;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between py-2">
              <code className="font-mono text-xs">{row.key}</code>
              <span className="tabular-nums">{formatNumber(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  </Card>
);

export const OverviewPage = () => {
  const [period, setPeriod] = useState<Period>('30d');
  const overview = usePeriodQuery<Overview>('overview', period);
  const timeseries = usePeriodQuery<Timeseries>('timeseries', period);
  const types = usePeriodQuery<{ types: TypeOutcome[] }>('types', period);
  const latency = usePeriodQuery<Latency>('latency', period);
  const error = overview.error ?? timeseries.error ?? types.error ?? latency.error;

  return (
    <>
      <SiteHeader />
      <div className="@container/main flex flex-1 flex-col gap-6 p-6">
        <PageHeader
          title="Overview"
          description={overview.data ? formatUtcRange(overview.data.from, overview.data.to) : ' '}
          actions={
            <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PERIODS) as Period[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {PERIODS[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {error ? <ErrorAlert error={error} /> : null}
        {overview.data && timeseries.data && types.data && latency.data ? (
          <>
            <MetricCards overview={overview.data} days={PERIODS[period].days} />
            <DailyChart overview={overview.data} timeseries={timeseries.data} />
            <LatencyCard latency={latency.data} />
            <TypeTable types={types.data.types} />
            <div className="grid gap-4 md:grid-cols-3">
              <CountList
                title="Top error codes"
                description="Failed and dead deliveries"
                rows={overview.data.topErrorCodes.map((r) => ({
                  key: r.errorCode,
                  count: r.count,
                }))}
                empty="No failures in this period."
              />
              <CountList
                title="Skip reasons"
                description="Deliveries that never went out"
                rows={overview.data.skipReasons.map((r) => ({ key: r.skipReason, count: r.count }))}
                empty="Nothing was skipped in this period."
              />
              <Card>
                <CardHeader>
                  <CardTitle>Scheduled</CardTitle>
                  <CardDescription>Waiting for their time to send</CardDescription>
                </CardHeader>
                <CardContent className="flex items-baseline gap-2">
                  <span className="font-semibold text-5xl tabular-nums">
                    {formatNumber(overview.data.scheduledPending)}
                  </span>
                  <span className="text-muted-foreground text-sm">pending</span>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/schedules">
                      View schedules <ArrowRight />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </>
        ) : error ? null : (
          <div className="grid gap-4">
            <Skeleton className="h-36" />
            <Skeleton className="h-80" />
            <Skeleton className="h-64" />
          </div>
        )}
      </div>
    </>
  );
};
