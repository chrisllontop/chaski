import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { ApiError } from '~/lib/api';

export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0 space-y-1">
      <h1 className="text-balance font-semibold text-xl tracking-tight">{title}</h1>
      {description ? (
        <p className="text-pretty text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
  </div>
);

/** What a failed request says to the person using the dashboard. */
export const ErrorAlert = ({
  error,
  title = 'We couldn’t load this.',
}: {
  error: unknown;
  title?: string;
}) => (
  <Alert variant="destructive">
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>
      {error instanceof ApiError ? error.message : 'Check your connection and try again.'}
    </AlertDescription>
  </Alert>
);
