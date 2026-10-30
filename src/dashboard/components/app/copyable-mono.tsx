import { cn } from 'cn';
import { Check, Copy } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { Button } from '~/components/ui/button';

/** Monospace value that truncates in the cell; the button copies the full string. */
export const CopyableMono = ({
  value,
  className,
  textClassName,
  pill = false,
}: {
  value: string;
  className?: string;
  textClassName?: string;
  pill?: boolean;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'group/copy flex min-w-0 max-w-[7.5rem] items-center gap-0.5 overflow-hidden',
        className,
      )}
    >
      {pill ? (
        <span
          className={cn(
            'inline-flex h-5 w-fit min-w-0 max-w-full shrink items-center overflow-hidden rounded-md border px-1.5',
            textClassName,
          )}
          title={value}
        >
          <span className="min-w-0 truncate font-mono text-xs">{value}</span>
        </span>
      ) : (
        <span
          className={cn('min-w-0 flex-1 truncate font-mono text-xs', textClassName)}
          title={value}
        >
          {value}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/copy:opacity-100 focus-visible:opacity-100',
          copied && 'opacity-100',
        )}
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy'}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
};
