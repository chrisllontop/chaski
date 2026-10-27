import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Pager } from '~/components/app/pager';
import { Pill } from '~/components/app/pill';
import { SiteHeader } from '~/components/app/site-header';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Skeleton } from '~/components/ui/skeleton';
import { api, query } from '~/lib/api';
import { useDebounced } from '~/lib/debounce';
import { formatDateTime, formatRelative } from '~/lib/format';
import { isOverdue } from '~/lib/schedules';
import type { ScheduledItem, SchedulePage } from '~/lib/types';

export const SchedulesPage = () => {
  const client = useQueryClient();
  const [contact, setContact] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [cancelling, setCancelling] = useState<ScheduledItem | null>(null);
  const recipientId = useDebounced(contact.trim(), 300);
  const groupKey = useDebounced(group.trim(), 300);

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
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-6 pt-6 pb-10">
        <PageHeader title="Schedules" description="Notifications waiting for their time to send" />
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
          <Input
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            placeholder="Filter by group…"
            className="h-8 w-52 text-[13px]"
          />
        </div>
        {list.error ? <ErrorAlert error={list.error} /> : null}
        <DataTable>
          <DataHeader>
            <DataRow>
              <DataHead>Sends</DataHead>
              <DataHead>Contact</DataHead>
              <DataHead>Type</DataHead>
              <DataHead>Group</DataHead>
              <DataHead>Key</DataHead>
              <DataHead className="w-24" />
            </DataRow>
          </DataHeader>
          <DataBody>
            {!list.data ? (
              <DataEmpty colSpan={6}>
                <Skeleton className="mx-auto h-4 w-48" />
              </DataEmpty>
            ) : list.data.schedules.length === 0 ? (
              <DataEmpty colSpan={6}>Nothing is scheduled.</DataEmpty>
            ) : (
              list.data.schedules.map((item) => (
                <DataRow key={item.id}>
                  <DataCell>
                    <div className="flex items-center gap-2 font-medium">
                      {formatRelative(item.scheduledAt)}
                      {isOverdue(item.scheduledAt) ? <Pill tone="warning">Overdue</Pill> : null}
                    </div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      {formatDateTime(item.scheduledAt)}
                    </div>
                  </DataCell>
                  <DataCell>{item.recipientId}</DataCell>
                  <DataCell className="font-mono text-xs">{item.type}</DataCell>
                  <DataCell>
                    {item.groupKey ? (
                      <span className="inline-flex h-5 items-center rounded-md border px-1.5 font-mono text-muted-foreground text-xs">
                        {item.groupKey}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </DataCell>
                  <DataCell className="max-w-56 truncate font-mono text-muted-foreground text-xs">
                    {item.idempotencyKey ?? '–'}
                  </DataCell>
                  <DataCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`text-muted-foreground hover:text-destructive ${rowActionClass}`}
                      onClick={() => setCancelling(item)}
                    >
                      Cancel
                    </Button>
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
