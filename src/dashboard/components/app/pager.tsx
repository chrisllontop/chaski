import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { formatNumber } from '~/lib/format';

/** Offset paging for the admin lists: pages count from 0, as the API does. */
export const Pager = ({
  page,
  limit,
  total,
  noun,
  onPage,
  onLimit,
}: {
  page: number;
  limit: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
  onLimit?: (limit: number) => void;
}) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : page * limit + 1;
  const last = Math.min(total, (page + 1) * limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">
        {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)} {noun}
      </span>
      <div className="flex items-center gap-6">
        {onLimit ? (
          <div className="flex items-center gap-2">
            <span className="font-medium">Rows per page</span>
            <Select value={String(limit)} onValueChange={(value) => onLimit(Number(value))}>
              <SelectTrigger size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <span className="font-medium">
          Page {formatNumber(page + 1)} of {formatNumber(pages)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page === 0}
            onClick={() => onPage(0)}
          >
            <ChevronsLeft />
            <span className="sr-only">First page</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft />
            <span className="sr-only">Previous page</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page >= pages - 1}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight />
            <span className="sr-only">Next page</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page >= pages - 1}
            onClick={() => onPage(pages - 1)}
          >
            <ChevronsRight />
            <span className="sr-only">Last page</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
