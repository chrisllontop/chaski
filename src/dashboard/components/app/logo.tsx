// The relay mark from brand/: one stroke that runs along a lane, steps across
// and carries on in the next.
export const LogoMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
    <path
      d="M5 9.5H12A4 4 0 0 1 16 13.5V18.5A4 4 0 0 0 20 22.5H27"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
