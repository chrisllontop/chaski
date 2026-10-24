import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { ApiError } from '~/lib/api';

export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) => (
  <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="space-y-1">
      <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
    </div>
    {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
  </div>
);

/** What a failed request says to the person using the dashboard. */
export const ErrorAlert = ({ error }: { error: unknown }) => (
  <Alert variant="destructive">
    <AlertTitle>We couldn’t load this.</AlertTitle>
    <AlertDescription>
      {error instanceof ApiError ? error.message : 'Check your connection and try again.'}
    </AlertDescription>
  </Alert>
);
