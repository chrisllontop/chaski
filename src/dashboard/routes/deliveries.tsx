import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { MoreHorizontal, RotateCcw, Search, Send, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import {
  DataBody,
  DataCell,
  DataEmpty,
  DataHead,
  DataHeader,
  DataRow,
  DataTable,
  rowActionClass,
} from '~/components/app/data-table';
import { ChannelLabel, STATUS_LABELS, StatusBadge } from '~/components/app/delivery-bits';
import { LanguageLabel } from '~/components/app/languages';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Pager } from '~/components/app/pager';
import { Pill } from '~/components/app/pill';
import { SiteHeader } from '~/components/app/site-header';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Skeleton } from '~/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { api, query } from '~/lib/api';
import { useChannelsOverview } from '~/lib/channels';
import { useDebounced } from '~/lib/debounce';
import {
  CHANNEL_LABELS,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelative,
} from '~/lib/format';
import { isFallback, languageNote, languagesOf, useLocales } from '~/lib/locales';
import type { Channel, Delivery, DeliveryPage, DeliveryStatus, TemplateSummary } from '~/lib/types';

type HeldSelection = { ids?: string[]; channel?: Channel; type?: string };

const STATUSES: DeliveryStatus[] = ['pending', 'held', 'sent', 'failed', 'dead', 'skipped'];
const REPLAYABLE: DeliveryStatus[] = ['failed', 'dead'];

const RANGES = {
  '24h': { label: 'Last 24 hours', hours: 24 },
  '7d': { label: 'Last 7 days', hours: 24 * 7 },
  '30d': { label: 'Last 30 days', hours: 24 * 30 },
  '90d': { label: 'Last 90 days', hours: 24 * 90 },
  all: { label: 'All time', hours: null },
} as const;

type Range = keyof typeof RANGES;
const ANY = 'any';

const since = (range: Range) => {
  const hours = RANGES[range].hours;
  return hours === null ? undefined : new Date(Date.now() - hours * 3_600_000).toISOString();
};

/** The filters a link can open the list with, such as the overview's failures. */
export type DeliverySearch = { status?: DeliveryStatus; type?: string; channel?: Channel };

// ─── Detail sheet ───

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-3 py-2 text-[13px]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </div>
);

type Step = {
  label: string;
  at: string | null;
  detail?: string | null;
  tone: 'done' | 'bad' | 'wait';
};

// What happened to a delivery, in order; durations count from the send.
const stepsOf = (delivery: Delivery): Step[] => {
  const after = (at: string) =>
    `${formatDuration(new Date(at).getTime() - new Date(delivery.createdAt).getTime())} after the send`;
  const steps: Step[] = [{ label: 'Sent to the queue', at: delivery.createdAt, tone: 'done' }];
  if (delivery.status === 'held') {
    steps.push({
      label: `Held: ${CHANNEL_LABELS[delivery.channel].toLowerCase()} is paused`,
      at: delivery.updatedAt,
      detail: 'It waits here until someone sends or discards it.',
      tone: 'wait',
    });
    return steps;
  }
  if (delivery.status === 'skipped') {
    steps.push({
      label: 'Skipped',
      at: delivery.updatedAt,
      detail: delivery.skipReason,
      tone: 'wait',
    });
    return steps;
  }
  if (delivery.status === 'sent' && delivery.sentAt) {
    steps.push({
      label: `Accepted by ${CHANNEL_LABELS[delivery.channel].toLowerCase()}`,
      at: delivery.sentAt,
      detail: after(delivery.sentAt),
      tone: 'done',
    });
  } else if (delivery.status === 'pending') {
    steps.push({
      label:
        delivery.attempts > 0
          ? `Retrying after attempt ${delivery.attempts}`
          : 'Waiting in the queue',
      at: null,
      detail: delivery.lastError,
      tone: 'wait',
    });
  } else {
    steps.push({
      label: delivery.status === 'dead' ? 'Out of attempts' : 'Failed',
      at: delivery.updatedAt,
      detail: delivery.lastError,
      tone: 'bad',
    });
  }
  if (delivery.openedAt) {
    steps.push({
      label: 'Opened',
      at: delivery.openedAt,
      detail: after(delivery.openedAt),
      tone: 'done',
    });
  }
  return steps;
};

const DOT = { done: 'bg-success', bad: 'bg-destructive', wait: 'bg-muted-foreground/50' };

const Timeline = ({ steps }: { steps: Step[] }) => (
  <ol className="relative ml-1 space-y-4 border-l pl-5">
    {steps.map((step) => (
      <li key={step.label} className="relative">
        <span
          className={`-left-[24.5px] absolute top-1.5 size-2 rounded-full ring-4 ring-background ${DOT[step.tone]}`}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
          <span className="font-medium">{step.label}</span>
          {step.at ? (
            <time className="text-muted-foreground text-xs tabular-nums" dateTime={step.at}>
              {formatDateTime(step.at)}
            </time>
          ) : null}
        </div>
        {step.detail ? (
          <p className="mt-0.5 break-words text-muted-foreground text-xs">{step.detail}</p>
        ) : null}
      </li>
    ))}
  </ol>
);

// What can happen to a held delivery: sent once its channel runs, or discarded.
type HeldActions = {
  isPaused: (channel: Channel) => boolean;
  onSend: (delivery: Delivery) => void;
  onDiscard: (delivery: Delivery) => void;
};

const DeliverySheet = ({
  deliveryId,
  onClose,
  onReplay,
  held,
}: {
  deliveryId: string | null;
  onClose: () => void;
  onReplay: (delivery: Delivery) => void;
  held: HeldActions;
}) => {
  const { data, error } = useQuery({
    queryKey: ['delivery', deliveryId],
    queryFn: () => api.get<{ delivery: Delivery }>(`deliveries/${deliveryId}`),
    enabled: deliveryId !== null,
  });
  const delivery = data?.delivery;
  const languages = languagesOf(useLocales().data);
  return (
    <Sheet open={deliveryId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="gap-2 border-b">
          {delivery ? (
            <div className="flex items-center gap-3">
              <StatusBadge status={delivery.status} />
              <span className="text-muted-foreground text-xs">
                <ChannelLabel channel={delivery.channel} />
              </span>
            </div>
          ) : null}
          <SheetTitle className="font-mono text-base">{delivery?.type ?? 'Delivery'}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{deliveryId}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 p-4">
          {error ? <ErrorAlert error={error} /> : null}
          {delivery ? (
            <>
              <section className="space-y-3">
                <h3 className="font-medium text-muted-foreground text-xs">Timeline</h3>
                <Timeline steps={stepsOf(delivery)} />
              </section>
              <section>
                <h3 className="mb-1 font-medium text-muted-foreground text-xs">Details</h3>
                <dl className="divide-y">
                  <Field label="Contact">
                    <div>{delivery.recipientId}</div>
                    {delivery.address ? (
                      <div className="text-muted-foreground">{delivery.address}</div>
                    ) : null}
                  </Field>
                  {languages && (delivery.requestedLocale || delivery.renderedLocale) ? (
                    <Field label="Language">
                      {delivery.renderedLocale ? (
                        <div>
                          <LanguageLabel locale={delivery.renderedLocale} />
                        </div>
                      ) : null}
                      <div className="text-muted-foreground">{languageNote(delivery)}</div>
                    </Field>
                  ) : null}
                  <Field label="Attempts">
                    <span className="tabular-nums">{delivery.attempts}</span>
                  </Field>
                  {delivery.sentAt ? (
                    <Field label="Provider time">
                      <span className="tabular-nums">{formatDuration(delivery.providerMs)}</span>
                    </Field>
                  ) : null}
                  {delivery.errorCode ? (
                    <Field label="Error code">
                      <code className="font-mono text-xs">{delivery.errorCode}</code>
                    </Field>
                  ) : null}
                  {delivery.skipReason ? (
                    <Field label="Skip reason">
                      <code className="font-mono text-xs">{delivery.skipReason}</code>
                    </Field>
                  ) : null}
                  {delivery.providerMessageId ? (
                    <Field label="Provider id">
                      <code className="font-mono text-xs">{delivery.providerMessageId}</code>
                    </Field>
                  ) : null}
                  <Field label="Notification">
                    <code className="font-mono text-xs">{delivery.notificationId}</code>
                  </Field>
                </dl>
              </section>
              <section className="space-y-2">
                <h3 className="font-medium text-muted-foreground text-xs">Payload</h3>
                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                  {JSON.stringify(delivery.payload, null, 2)}
                </pre>
              </section>
            </>
          ) : error ? null : (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
            </div>
          )}
        </div>
        {delivery && REPLAYABLE.includes(delivery.status) ? (
          <SheetFooter className="border-t">
            <Button onClick={() => onReplay(delivery)}>
              <RotateCcw /> Replay delivery
            </Button>
          </SheetFooter>
        ) : null}
        {delivery?.status === 'held' ? (
          <SheetFooter className="border-t">
            {held.isPaused(delivery.channel) ? (
              <p className="text-muted-foreground text-xs">
                Resume {CHANNEL_LABELS[delivery.channel].toLowerCase()} under Channels to send it.
              </p>
            ) : (
              <Button onClick={() => held.onSend(delivery)}>
                <Send /> Send delivery
              </Button>
            )}
            <Button variant="outline" onClick={() => held.onDiscard(delivery)}>
              <Trash2 /> Discard delivery
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

// ─── Page ───

export const DeliveriesPage = () => {
  const client = useQueryClient();
  const search = useSearch({ strict: false }) as DeliverySearch;
  const [status, setStatus] = useState<DeliveryStatus | 'all'>(search.status ?? 'all');
  const [contact, setContact] = useState('');
  const [channel, setChannel] = useState<Channel | typeof ANY>(search.channel ?? ANY);
  const [type, setType] = useState<string>(search.type ?? ANY);
  const [opened, setOpened] = useState<'opened' | 'unopened' | typeof ANY>(ANY);
  const [range, setRange] = useState<Range>('30d');
  const [from, setFrom] = useState(() => since('30d'));
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<Delivery | null>(null);
  const [replayingDead, setReplayingDead] = useState(false);
  const [sending, setSending] = useState<Delivery | null>(null);
  const [discarding, setDiscarding] = useState<Delivery | null>(null);
  const [bulk, setBulk] = useState<'send' | 'discard' | null>(null);
  const channels = useChannelsOverview();
  const languages = languagesOf(useLocales().data);
  const columns = languages ? 8 : 7;
  const recipientId = useDebounced(contact.trim(), 300);

  const filters = {
    from,
    channel: channel === ANY ? undefined : channel,
    type: type === ANY ? undefined : type,
    recipientId: recipientId || undefined,
    opened: opened === ANY ? undefined : opened === 'opened',
  };

  // Any filter change starts the list over at the first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the filters are the trigger
  useEffect(() => setPage(0), [status, from, channel, type, recipientId, opened, limit]);

  const counts = useQuery({
    queryKey: ['deliveries', 'counts', filters],
    queryFn: () =>
      api.get<{ counts: Record<string, number> }>(`deliveries/counts${query(filters)}`),
  });
  const list = useQuery({
    queryKey: ['deliveries', 'list', filters, status, page, limit],
    queryFn: () =>
      api.get<DeliveryPage>(
        `deliveries${query({ ...filters, status: status === 'all' ? undefined : status, page, limit })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: TemplateSummary[] }>('templates'),
  });

  // Replaying dead deliveries takes every dead one, whatever the filters show,
  // so the button counts them without filters.
  const unfiltered = useQuery({
    queryKey: ['deliveries', 'counts', 'unfiltered'],
    queryFn: () => api.get<{ counts: Record<string, number> }>('deliveries/counts'),
  });

  // Held deliveries are sent or discarded by channel and type, so the bulk actions count by those.
  const selection = { channel: filters.channel, type: filters.type };
  const heldCounts = useQuery({
    queryKey: ['deliveries', 'counts', selection],
    queryFn: () =>
      api.get<{ counts: Record<string, number> }>(`deliveries/counts${query(selection)}`),
  });

  const byStatus = counts.data?.counts ?? {};
  const all = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const dead = unfiltered.data?.counts.dead ?? 0;
  const heldTotal = heldCounts.data?.counts.held ?? 0;
  const isPaused = (key: Channel) =>
    channels.data?.channels.some((c) => c.channel === key && c.paused !== null) ?? false;

  const invalidate = () => client.invalidateQueries({ queryKey: ['deliveries'] });
  const replay = useMutation({
    mutationFn: (id: string) => api.post(`deliveries/${id}/replay`),
    onSuccess: () => {
      void invalidate();
      void client.invalidateQueries({ queryKey: ['delivery'] });
    },
  });
  const replayDead = useMutation({
    mutationFn: () => api.post<{ requeued: number }>('deliveries/replay-dead'),
    onSuccess: () => void invalidate(),
  });
  const actOnHeld = useMutation({
    mutationFn: ({ action, ...body }: { action: 'send' | 'discard' } & HeldSelection) =>
      api.post(`deliveries/held/${action}`, body),
    onSuccess: () => {
      void invalidate();
      void client.invalidateQueries({ queryKey: ['delivery'] });
    },
  });
  const held: HeldActions = {
    isPaused,
    onSend: setSending,
    onDiscard: setDiscarding,
  };
  const scope = [
    filters.channel ? CHANNEL_LABELS[filters.channel].toLowerCase() : null,
    filters.type,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-6 pt-6 pb-10">
        <PageHeader
          title="Deliveries"
          description="One row per notification and channel, latest change first"
          actions={
            <>
              {heldTotal > 0 ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setBulk('discard')}>
                    <Trash2 /> Discard {formatNumber(heldTotal)} held
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setBulk('send')}>
                    <Send /> Send {formatNumber(heldTotal)} held
                  </Button>
                </>
              ) : null}
              {dead > 0 ? (
                <Button variant="outline" size="sm" onClick={() => setReplayingDead(true)}>
                  <RotateCcw /> Replay {formatNumber(dead)} dead{' '}
                  {dead === 1 ? 'delivery' : 'deliveries'}
                </Button>
              ) : null}
            </>
          }
        />

        <Tabs value={status} onValueChange={(value) => setStatus(value as DeliveryStatus | 'all')}>
          <TabsList variant="line" className="w-full justify-start border-b">
            {(['all', ...STATUSES] as const).map((key) => (
              <TabsTrigger key={key} value={key} className="flex-none px-3">
                {key === 'all' ? 'All' : STATUS_LABELS[key]}
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatNumber(key === 'all' ? all : (byStatus[key] ?? 0))}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-60">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Filter by contact ID…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Select
            value={channel}
            onValueChange={(value) => setChannel(value as Channel | typeof ANY)}
          >
            <SelectTrigger size="sm" className="w-36 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All channels</SelectItem>
              {(Object.keys(CHANNEL_LABELS) as Channel[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {CHANNEL_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger size="sm" className="w-48 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All types</SelectItem>
              {(templates.data?.templates ?? []).map((template) => (
                <SelectItem key={template.id} value={template.type}>
                  {template.type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={opened} onValueChange={(value) => setOpened(value as typeof opened)}>
            <SelectTrigger size="sm" className="w-36 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Opened or not</SelectItem>
              <SelectItem value="opened">Opened</SelectItem>
              <SelectItem value="unopened">Not opened</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={range}
            onValueChange={(value) => {
              setRange(value as Range);
              setFrom(since(value as Range));
            }}
          >
            <SelectTrigger size="sm" className="ml-auto w-36 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {(Object.keys(RANGES) as Range[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {RANGES[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {list.error ? <ErrorAlert error={list.error} /> : null}

        <DataTable>
          <DataHeader>
            <DataRow>
              <DataHead>Contact</DataHead>
              <DataHead>Type</DataHead>
              <DataHead>Channel</DataHead>
              {languages ? <DataHead>Language</DataHead> : null}
              <DataHead>Status</DataHead>
              <DataHead numeric>Attempts</DataHead>
              <DataHead className="text-start">Updated</DataHead>
              <DataHead className="w-10" />
            </DataRow>
          </DataHeader>
          <DataBody>
            {!list.data ? (
              Array.from({ length: 8 }, (_, row) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
                <DataRow key={row}>
                  <DataCell colSpan={columns}>
                    <Skeleton className="h-4 w-full" />
                  </DataCell>
                </DataRow>
              ))
            ) : list.data.deliveries.length === 0 ? (
              <DataEmpty colSpan={columns}>No deliveries match these filters.</DataEmpty>
            ) : (
              list.data.deliveries.map((delivery) => (
                <DataRow
                  key={delivery.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(delivery.id)}
                >
                  <DataCell>
                    <div className="font-medium">{delivery.recipientId}</div>
                    {delivery.address ? (
                      <div className="text-muted-foreground text-xs">{delivery.address}</div>
                    ) : null}
                  </DataCell>
                  <DataCell className="font-mono text-xs">{delivery.type}</DataCell>
                  <DataCell>
                    <ChannelLabel channel={delivery.channel} />
                  </DataCell>
                  {languages ? (
                    <DataCell>
                      {delivery.renderedLocale ? (
                        <span className="whitespace-nowrap">
                          <code className="font-mono text-xs">{delivery.renderedLocale}</code>
                          {isFallback(delivery.requestedLocale, delivery.renderedLocale) ? (
                            <span className="text-muted-foreground text-xs"> · fallback</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </DataCell>
                  ) : null}
                  <DataCell>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={delivery.status} />
                      {delivery.openedAt ? (
                        <span title={`Opened ${formatDateTime(delivery.openedAt)}`}>
                          <Pill tone="info">Opened</Pill>
                        </span>
                      ) : null}
                    </div>
                  </DataCell>
                  <DataCell numeric>{delivery.attempts}</DataCell>
                  <DataCell className="text-start text-muted-foreground">
                    <time dateTime={delivery.updatedAt} title={formatDateTime(delivery.updatedAt)}>
                      {formatRelative(delivery.updatedAt)}
                    </time>
                  </DataCell>
                  <DataCell onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`size-7 text-muted-foreground ${rowActionClass}`}
                        >
                          <MoreHorizontal />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSelected(delivery.id)}>
                          View details
                        </DropdownMenuItem>
                        {REPLAYABLE.includes(delivery.status) ? (
                          <DropdownMenuItem onClick={() => setReplaying(delivery)}>
                            Replay delivery
                          </DropdownMenuItem>
                        ) : null}
                        {delivery.status === 'held' ? (
                          <>
                            <DropdownMenuItem
                              disabled={isPaused(delivery.channel)}
                              onClick={() => setSending(delivery)}
                            >
                              {isPaused(delivery.channel)
                                ? `Resume ${CHANNEL_LABELS[delivery.channel].toLowerCase()} to send`
                                : 'Send delivery'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDiscarding(delivery)}
                            >
                              Discard delivery
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </DataCell>
                </DataRow>
              ))
            )}
          </DataBody>
        </DataTable>

        {list.data ? (
          <Pager
            page={page}
            limit={limit}
            total={list.data.total}
            noun="deliveries"
            onPage={setPage}
            onLimit={setLimit}
          />
        ) : null}
      </div>

      <DeliverySheet
        deliveryId={selected}
        onClose={() => setSelected(null)}
        onReplay={setReplaying}
        held={held}
      />

      <ConfirmDialog
        open={sending !== null}
        onOpenChange={(open) => !open && setSending(null)}
        title="Send this held delivery?"
        description={
          sending
            ? `The ${CHANNEL_LABELS[sending.channel]} delivery of ${sending.type} to ${sending.recipientId} goes on the queue, held since ${formatRelative(sending.updatedAt)}.`
            : null
        }
        action="Send delivery"
        onConfirm={() => actOnHeld.mutateAsync({ action: 'send', ids: [sending?.id ?? ''] })}
      />

      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => !open && setDiscarding(null)}
        title="Discard this held delivery?"
        description={
          discarding
            ? `The ${CHANNEL_LABELS[discarding.channel]} delivery of ${discarding.type} to ${discarding.recipientId} never goes out, and shows as skipped. It can’t be undone.`
            : null
        }
        action="Discard delivery"
        onConfirm={() => actOnHeld.mutateAsync({ action: 'discard', ids: [discarding?.id ?? ''] })}
      />

      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(open) => !open && setBulk(null)}
        title={`${bulk === 'send' ? 'Send' : 'Discard'} ${formatNumber(heldTotal)} held ${scope ? `${scope} ` : ''}${heldTotal === 1 ? 'delivery' : 'deliveries'}?`}
        description={
          bulk === 'send'
            ? `They go on the queue, up to 500 at a time. A channel that is still paused keeps its own until you resume it.`
            : `They never go out, and show as skipped, up to 500 at a time. It can’t be undone.`
        }
        action={bulk === 'send' ? 'Send held' : 'Discard held'}
        onConfirm={() => actOnHeld.mutateAsync({ action: bulk ?? 'send', ...selection })}
      />

      <ConfirmDialog
        open={replaying !== null}
        onOpenChange={(open) => !open && setReplaying(null)}
        title="Replay this delivery?"
        description={
          replaying
            ? `The ${CHANNEL_LABELS[replaying.channel]} delivery of ${replaying.type} to ${replaying.recipientId} goes back on the queue and restarts from attempt 1.`
            : null
        }
        action="Replay delivery"
        onConfirm={() => replay.mutateAsync(replaying?.id ?? '')}
      />

      <ConfirmDialog
        open={replayingDead}
        onOpenChange={setReplayingDead}
        title={`Replay ${formatNumber(dead)} dead ${dead === 1 ? 'delivery' : 'deliveries'}?`}
        description={
          dead > 500
            ? `The first 500 dead deliveries go back on the queue and restart from attempt 1. Replay again for the rest.`
            : `${formatNumber(dead)} dead ${dead === 1 ? 'delivery goes' : 'deliveries go'} back on the queue and restart from attempt 1.`
        }
        action={`Replay ${dead === 1 ? 'delivery' : 'deliveries'}`}
        onConfirm={() => replayDead.mutateAsync()}
      />
    </>
  );
};
