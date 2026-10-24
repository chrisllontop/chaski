import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import { ChannelLabel, STATUS_LABELS, StatusBadge } from '~/components/app/delivery-bits';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Pager } from '~/components/app/pager';
import { SiteHeader } from '~/components/app/site-header';
import { Badge } from '~/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { api, query } from '~/lib/api';
import { CHANNEL_LABELS, formatDateTime, formatNumber } from '~/lib/format';
import type { Channel, Delivery, DeliveryPage, DeliveryStatus, TemplateSummary } from '~/lib/types';

const STATUSES: DeliveryStatus[] = ['pending', 'sent', 'failed', 'dead', 'skipped'];
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

const useDebounced = (value: string, delayMs = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

// ─── Detail sheet ───

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-3 gap-2 py-2 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="col-span-2 break-words">{children}</dd>
  </div>
);

const DeliverySheet = ({
  deliveryId,
  onClose,
  onReplay,
}: {
  deliveryId: string | null;
  onClose: () => void;
  onReplay: (delivery: Delivery) => void;
}) => {
  const { data, error } = useQuery({
    queryKey: ['delivery', deliveryId],
    queryFn: () => api.get<{ delivery: Delivery }>(`deliveries/${deliveryId}`),
    enabled: deliveryId !== null,
  });
  const delivery = data?.delivery;
  return (
    <Sheet open={deliveryId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Delivery</SheetTitle>
          <SheetDescription className="font-mono text-xs">{deliveryId}</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          {error ? <ErrorAlert error={error} /> : null}
          {delivery ? (
            <dl className="divide-y">
              <Field label="Status">
                <StatusBadge status={delivery.status} />
              </Field>
              <Field label="Contact">
                <div>{delivery.recipientId}</div>
                {delivery.address ? (
                  <div className="text-muted-foreground">{delivery.address}</div>
                ) : null}
              </Field>
              <Field label="Type">{delivery.type}</Field>
              <Field label="Channel">
                <ChannelLabel channel={delivery.channel} />
              </Field>
              <Field label="Attempts">{delivery.attempts}</Field>
              {delivery.skipReason ? (
                <Field label="Skip reason">
                  <code className="font-mono text-xs">{delivery.skipReason}</code>
                </Field>
              ) : null}
              {delivery.errorCode ? (
                <Field label="Error code">
                  <code className="font-mono text-xs">{delivery.errorCode}</code>
                </Field>
              ) : null}
              {delivery.lastError ? (
                <Field label="Last error">
                  <code className="font-mono text-xs">{delivery.lastError}</code>
                </Field>
              ) : null}
              {delivery.providerMessageId ? (
                <Field label="Provider id">
                  <code className="font-mono text-xs">{delivery.providerMessageId}</code>
                </Field>
              ) : null}
              <Field label="Created">{formatDateTime(delivery.createdAt)}</Field>
              <Field label="Sent">{formatDateTime(delivery.sentAt)}</Field>
              {delivery.channel === 'email' ? (
                <Field label="Opened">{formatDateTime(delivery.openedAt)}</Field>
              ) : null}
              <Field label="Updated">{formatDateTime(delivery.updatedAt)}</Field>
              <div className="space-y-2 py-3">
                <div className="text-muted-foreground text-sm">Payload</div>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(delivery.payload, null, 2)}
                </pre>
              </div>
            </dl>
          ) : null}
        </div>
        {delivery && REPLAYABLE.includes(delivery.status) ? (
          <SheetFooter>
            <Button onClick={() => onReplay(delivery)}>
              <RotateCcw /> Replay delivery
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
  const [status, setStatus] = useState<DeliveryStatus | 'all'>('all');
  const [contact, setContact] = useState('');
  const [channel, setChannel] = useState<Channel | typeof ANY>(ANY);
  const [type, setType] = useState<string>(ANY);
  const [opened, setOpened] = useState<'opened' | 'unopened' | typeof ANY>(ANY);
  const [range, setRange] = useState<Range>('30d');
  const [from, setFrom] = useState(() => since('30d'));
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<Delivery | null>(null);
  const [replayingDead, setReplayingDead] = useState(false);
  const recipientId = useDebounced(contact.trim());

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

  const byStatus = counts.data?.counts ?? {};
  const all = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const dead = unfiltered.data?.counts.dead ?? 0;

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

  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <PageHeader
          title="Deliveries"
          description="One row per notification and channel"
          actions={
            dead > 0 ? (
              <Button variant="outline" onClick={() => setReplayingDead(true)}>
                <RotateCcw /> Replay {formatNumber(dead)} dead{' '}
                {dead === 1 ? 'delivery' : 'deliveries'}
              </Button>
            ) : null
          }
        />

        <Tabs value={status} onValueChange={(value) => setStatus(value as DeliveryStatus | 'all')}>
          <TabsList>
            <TabsTrigger value="all">
              All <Badge variant="secondary">{formatNumber(all)}</Badge>
            </TabsTrigger>
            {STATUSES.map((key) => (
              <TabsTrigger key={key} value={key}>
                {STATUS_LABELS[key]}{' '}
                <Badge variant="secondary">{formatNumber(byStatus[key] ?? 0)}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Filter by contact ID…"
              className="pl-8"
            />
          </div>
          <Select
            value={channel}
            onValueChange={(value) => setChannel(value as Channel | typeof ANY)}
          >
            <SelectTrigger className="w-36 border-dashed">
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
            <SelectTrigger className="w-44 border-dashed">
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
            <SelectTrigger className="w-36 border-dashed">
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
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGES) as Range[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {RANGES[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {list.error ? <ErrorAlert error={list.error} /> : null}

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.deliveries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No deliveries match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                list.data?.deliveries.map((delivery) => (
                  <TableRow
                    key={delivery.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(delivery.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{delivery.recipientId}</div>
                      {delivery.address ? (
                        <div className="text-muted-foreground text-xs">{delivery.address}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{delivery.type}</TableCell>
                    <TableCell>
                      <ChannelLabel channel={delivery.channel} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={delivery.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{delivery.attempts}</TableCell>
                    <TableCell>{formatDateTime(delivery.openedAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(delivery.updatedAt)}
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                          >
                            <MoreVertical />
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
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

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
