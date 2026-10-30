import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';

/** A table with quiet headers, hairline rows and numbers that line up; `bare` inside a Panel. */
export const DataTable = ({
  bare = false,
  className,
  children,
}: {
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div className={cn(!bare && 'overflow-hidden rounded-lg border bg-card', className)}>
    <Table className="text-[13px]">{children}</Table>
  </div>
);

export const DataHeader = ({ children }: { children: ReactNode }) => (
  <TableHeader className="bg-muted/40 [&_tr]:hover:bg-transparent">{children}</TableHeader>
);

export const DataBody = TableBody;

export const DataRow = ({ className, ...props }: ComponentProps<typeof TableRow>) => (
  <TableRow className={cn('group/row', className)} {...props} />
);

export const DataHead = ({
  numeric = false,
  className,
  ...props
}: ComponentProps<typeof TableHead> & { numeric?: boolean }) => (
  <TableHead
    className={cn(
      'h-9 px-3 font-medium text-muted-foreground text-xs first:pl-4 last:pr-4',
      numeric && 'text-right',
      className,
    )}
    {...props}
  />
);

export const DataCell = ({
  numeric = false,
  className,
  ...props
}: ComponentProps<typeof TableCell> & { numeric?: boolean }) => (
  <TableCell
    className={cn(
      'h-11 px-3 py-1.5 first:pl-4 last:pr-4 whitespace-normal break-words',
      numeric && 'whitespace-nowrap text-right tabular-nums',
      className,
    )}
    {...props}
  />
);

export const DataEmpty = ({ colSpan, children }: { colSpan: number; children: ReactNode }) => (
  <TableRow className="hover:bg-transparent">
    <TableCell colSpan={colSpan} className="h-32 text-center text-muted-foreground">
      {children}
    </TableCell>
  </TableRow>
);

/** Row actions stay out of the way until the row is hovered or focused. */
export const rowActionClass =
  'opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';
