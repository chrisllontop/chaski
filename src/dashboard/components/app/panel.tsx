import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';

/** A bordered surface one step above the page; sections of a screen sit in these. */
export const Panel = ({ className, ...props }: ComponentProps<'section'>) => (
  <section
    className={cn('overflow-hidden rounded-lg border bg-card text-card-foreground', className)}
    {...props}
  />
);

export const PanelHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => (
  <header
    className={cn(
      'flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5',
      className,
    )}
  >
    <div className="min-w-0 flex-1">
      <h2 className="font-medium text-sm leading-6">{title}</h2>
      {description ? (
        <p className="text-pretty text-muted-foreground text-xs">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
  </header>
);
