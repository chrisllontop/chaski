const TONES = {
  success: 'bg-success/12 text-success',
  info: 'bg-info/12 text-info',
} as const;

export const StatusPill = ({
  tone,
  children,
  pulse = false,
}: {
  tone: keyof typeof TONES;
  children: string;
  pulse?: boolean;
}) => (
  <span
    className={`flex h-5 w-max shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs leading-4 font-medium ${TONES[tone]}`}
  >
    <span
      className={`relative size-1.5 shrink-0 rounded-full bg-current ${pulse ? 'pulse-ring' : ''}`}
      aria-hidden="true"
    />
    {children}
  </span>
);
