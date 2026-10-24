import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Pager } from '~/components/app/pager';
import { SiteHeader } from '~/components/app/site-header';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api, query } from '~/lib/api';
import { formatDateTime, formatRelative } from '~/lib/format';
import type { ScheduledItem, SchedulePage } from '~/lib/types';

const useDebounced = (value: string, delayMs = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

export const SchedulesPage = () => {
  const client = useQueryClient();
  const [contact, setContact] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [cancelling, setCancelling] = useState<ScheduledItem | null>(null);
  const recipientId = useDebounced(contact.trim());
  const groupKey = useDebounced(group.trim());

  // biome-ignore lint/correctness/useExhaustiveDependencies: the filters are the trigger
  useEffect(() => setPage(0), [recipientId, groupKey, limit]);

  const list = useQuery({
    queryKey: ['schedules', recipientId, groupKey, page, limit],
    queryFn: () =>
      api.get<SchedulePage>(`schedules${query({ recipientId, groupKey, page, limit })}`),
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`schedules/${id}/cancel`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['schedules'] });
      void client.invalidateQueries({ queryKey: ['metrics'] });
    },
  });

  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <PageHeader title="Schedules" description="Notifications waiting for their time to send" />
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
          <Input
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            placeholder="Filter by group…"
            className="w-56"
          />
        </div>
        {list.error ? <ErrorAlert error={list.error} /> : null}
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Sends</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.schedules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Nothing is scheduled.
                  </TableCell>
                </TableRow>
              ) : (
                list.data?.schedules.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.recipientId}</TableCell>
                    <TableCell className="font-mono">{item.type}</TableCell>
                    <TableCell>
                      <div>{formatDateTime(item.scheduledAt)}</div>
                      <div className="text-muted-foreground text-xs">
                        {formatRelative(item.scheduledAt)}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {item.groupKey ?? '–'}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {item.idempotencyKey ?? '–'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setCancelling(item)}>
                        Cancel
                      </Button>
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
            noun="pending"
            onPage={setPage}
            onLimit={setLimit}
          />
        ) : null}
      </div>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel this scheduled notification?"
        description={
          cancelling
            ? `${cancelling.type} for ${cancelling.recipientId} won’t go out at ${formatDateTime(cancelling.scheduledAt)}. This can’t be undone.`
            : null
        }
        action="Cancel notification"
        onConfirm={() => cancel.mutateAsync(cancelling?.id ?? '')}
      />
    </>
  );
};
