import { Link } from '@tanstack/react-router';
import { CopyStatus, useCopy } from './copy';
import { ArrowRightIcon, CheckIcon, CopyIcon } from './icons';

const INSTALL = 'npm install chaski';

export const DocsButton = () => (
  <Link
    to="/docs/$"
    params={{ _splat: '' }}
    className="group flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-[15px] leading-5 font-medium text-primary-foreground transition-colors duration-150 hover:bg-white motion-safe:transition-[background-color,scale] motion-safe:active:scale-[.98]"
  >
    Read the docs
    <ArrowRightIcon className="motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:translate-x-0.5" />
  </Link>
);

export const InstallButton = () => {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(INSTALL)}
      aria-label={`Copy “${INSTALL}”`}
      className="group flex h-11 cursor-pointer items-center gap-3.5 rounded-lg border border-border bg-card pr-3.5 pl-4 font-mono text-sm leading-5 transition-colors duration-150 hover:border-white/15 motion-safe:transition-[border-color,scale] motion-safe:active:scale-[.98]"
    >
      <span className="text-muted-foreground">$</span>
      <span>{INSTALL}</span>
      {copied ? (
        <CheckIcon className="text-success" />
      ) : (
        <CopyIcon className="text-muted-foreground transition-colors group-hover:text-foreground" />
      )}
      <CopyStatus copied={copied} />
    </button>
  );
};
