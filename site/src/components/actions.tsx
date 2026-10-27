import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { setupPrompt } from '~/lib/site';
import { CopyStatus, useCopy } from './copy';
import { ArrowRightIcon, CheckIcon, CopyIcon } from './icons';

const INSTALL = 'npm install chaskijs';

const WAYS = ['npm', 'agent'] as const;
type Way = (typeof WAYS)[number];

const WAY_KEYS: Record<string, (index: number) => number> = {
  ArrowRight: (index) => (index + 1) % WAYS.length,
  ArrowLeft: (index) => (index - 1 + WAYS.length) % WAYS.length,
  Home: () => 0,
  End: () => WAYS.length - 1,
};

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

const CopyWay = ({ way }: { way: Way }) => {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      data-copy=""
      onClick={() => copy(way === 'npm' ? INSTALL : setupPrompt)}
      aria-label={way === 'npm' ? `Copy “${INSTALL}”` : undefined}
      className="group flex h-[42px] cursor-pointer items-center gap-2.5 pr-3 focus-visible:outline-offset-0 sm:gap-3.5 sm:pr-3.5"
    >
      {way === 'npm' ? (
        <>
          <span className="font-mono text-sm leading-5 text-muted-foreground max-sm:hidden">$</span>
          <span className="font-mono text-[13px] leading-5 sm:text-sm">{INSTALL}</span>
        </>
      ) : (
        <span className="text-[15px] leading-5 font-medium">Copy the setup prompt</span>
      )}
      {copied ? (
        <CheckIcon className="text-success" />
      ) : (
        <CopyIcon className="text-muted-foreground transition-colors group-hover:text-foreground" />
      )}
      <CopyStatus copied={copied} />
    </button>
  );
};

/** The two ways in: install the package, or copy the prompt that hands the setup to an agent. */
export const InstallChip = ({ initial }: { initial: Way }) => {
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [way, setWay] = useState(initial);

  const onKey = (event: KeyboardEvent) => {
    const next = WAY_KEYS[event.key]?.(WAYS.indexOf(way));
    if (next === undefined) return;
    event.preventDefault();
    setWay(WAYS[next] ?? way);
    tabs.current[next]?.focus();
  };

  return (
    <div className="flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card pl-1 transition-colors duration-150 hover:border-white/15 sm:gap-3.5 motion-safe:transition-[border-color,scale] motion-safe:has-[[data-copy]:active]:scale-[.98]">
      <div role="tablist" aria-label="Get Chaski with" className="flex items-center gap-0.5">
        {WAYS.map((name, index) => (
          <button
            key={name}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-${name}`}
            aria-controls={`${id}-panel`}
            aria-selected={name === way}
            tabIndex={name === way ? 0 : -1}
            onClick={() => setWay(name)}
            onKeyDown={onKey}
            className="flex h-[34px] cursor-pointer items-center rounded-md px-2.5 font-mono text-[13px] leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-0 aria-selected:bg-muted aria-selected:text-foreground"
          >
            {name}
          </button>
        ))}
      </div>
      <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${way}`}>
        {/* A fresh button per way, so a check from the last copy never shows on the other. */}
        <CopyWay key={way} way={way} />
      </div>
    </div>
  );
};
