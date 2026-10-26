import { cn } from 'cn';
import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/14 text-warning',
  danger: 'bg-destructive/12 text-destructive',
  info: 'bg-chart-2/12 text-chart-2',
  neutral: 'bg-muted text-muted-foreground',
};

/** A state in a word: tinted, with a dot, so color is never the only cue. */
export const Pill = ({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) => (
  <span
    className={cn(
      'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 font-medium text-xs',
      TONES[tone],
      className,
    )}
  >
    <span className={cn('size-1.5 rounded-full bg-current', pulse && 'animate-pulse')} />
    {children}
  </span>
);
