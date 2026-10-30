import type { ReactNode } from 'react';
import { BellIcon, GlobeIcon, LockIcon, MailIcon, Mark, PhoneIcon, TerminalIcon } from '../icons';
import { StatusPill } from './status';

const ROLES = [
  {
    who: 'Your team',
    text: 'Sets up the channels, writes the templates and follows every delivery, in a dashboard behind your company’s sign-in.',
  },
  {
    who: 'Your app',
    text: 'Sends with one call, and serves its frontend the signed-in user’s feed, devices and preferences.',
  },
  {
    who: 'Mobile apps',
    text: 'Register for push and read the feed through your app, as the signed-in user.',
  },
  {
    who: 'Each environment',
    text: 'Gets a Chaski of its own, with its own data and settings: staging never sends with production’s keys.',
  },
];

// A compact node drops its icon on phones, where two share half the card.
const Node = ({
  icon,
  label,
  meta,
  delay,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  delay: string;
  compact?: boolean;
}) => (
  <div
    className={`play-row flex h-11 min-w-0 items-center gap-2.5 rounded-[10px] border border-border bg-background px-3.5 ${compact ? 'max-sm:justify-center max-sm:px-2' : ''} ${delay}`}
  >
    <span className={`shrink-0 text-muted-foreground ${compact ? 'max-sm:hidden' : ''}`}>
      {icon}
    </span>
    <span className="truncate text-[13px] leading-[18px]">{label}</span>
    {meta ? (
      <span className="ml-auto shrink-0 font-mono text-xs leading-4 text-muted-foreground max-sm:hidden">
        {meta}
      </span>
    ) : null}
  </div>
);

const Wire = ({ delay, label }: { delay: string; label?: string }) => (
  <div className="relative flex h-8 justify-center">
    <span className={`play-line block h-full w-0.5 origin-top bg-signal ${delay}`} />
    {label ? (
      <span className="absolute top-1/2 left-1/2 ml-3 -translate-y-1/2 font-mono text-[11.5px] leading-4 text-muted-foreground">
        {label}
      </span>
    ) : null}
  </div>
);

const Channel = ({ icon, label, delay }: { icon: ReactNode; label: string; delay: string }) => (
  <li className={`play-row flex h-11 items-center gap-2.5 px-4 ${delay}`}>
    <span className="shrink-0 text-muted-foreground">{icon}</span>
    <span className="w-16 shrink-0 text-[13px] leading-[18px]">{label}</span>
    <StatusPill tone="success">On</StatusPill>
  </li>
);

/** Where Chaski sits: your product reaches it through bindings, and your team works in its dashboard. */
const Topology = () => (
  <figure
    data-play=""
    data-reveal=""
    className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-6"
  >
    <figcaption className="sr-only">
      Web and mobile apps reach Chaski through your app’s Worker, your other Workers bind to it
      directly, and your team sets up its channels in its dashboard.
    </figcaption>
    <div aria-hidden="true" className="grid grid-cols-2 gap-x-3">
      <div className="grid grid-cols-2 gap-2">
        <Node icon={<GlobeIcon />} label="Web" delay="[animation-delay:100ms]" compact />
        <Node icon={<PhoneIcon />} label="Mobile" delay="[animation-delay:200ms]" compact />
      </div>
      <div />
      <Wire delay="[animation-delay:350ms]" />
      <div />
      <Node
        icon={<TerminalIcon />}
        label="Your app"
        meta="userRoutes()"
        delay="[animation-delay:500ms]"
      />
      <Node icon={<TerminalIcon />} label="Other Workers" delay="[animation-delay:600ms]" />
      <Wire delay="[animation-delay:750ms]" label="env.CHASKI" />
      <Wire delay="[animation-delay:750ms]" />
    </div>
    <div
      aria-hidden="true"
      className="play-row overflow-hidden rounded-xl border border-border bg-background [animation-delay:950ms]"
    >
      <div className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
        <span className="flex items-center gap-2 text-[13px] leading-[18px] font-medium">
          <Mark size={16} className="text-signal" />
          Chaski
        </span>
        <span className="flex gap-0.5 rounded-md bg-muted p-0.5 font-mono text-[11.5px] leading-4">
          <span className="rounded bg-card px-1.5 py-0.5">production</span>
          <span className="px-1.5 py-0.5 text-muted-foreground">staging</span>
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        <li className="play-row flex h-11 items-center gap-2.5 px-4 [animation-delay:1100ms]">
          <span className="shrink-0 text-muted-foreground">
            <LockIcon />
          </span>
          <span className="text-[13px] leading-[18px]">Dashboard</span>
          <span className="ml-auto font-mono text-xs leading-4 text-muted-foreground">
            your team
          </span>
        </li>
        <Channel icon={<MailIcon />} label="Email" delay="[animation-delay:1250ms]" />
        <Channel icon={<PhoneIcon />} label="Push" delay="[animation-delay:1400ms]" />
        <Channel icon={<BellIcon />} label="In-app" delay="[animation-delay:1550ms]" />
      </ul>
    </div>
  </figure>
);

export const Usage = () => (
  <section
    id="in-use"
    className="wrap grid grid-cols-1 items-center gap-16 pt-32 lg:grid-cols-[1fr_520px] lg:gap-24 lg:pt-40"
    aria-labelledby="usage-title"
  >
    <div data-reveal="" className="flex flex-col gap-5">
      <p className="kicker">In use</p>
      <h2 id="usage-title" className="h2">
        Your team runs it. Your apps call it.
      </h2>
      <p className="lede">
        Every environment of your product gets a Chaski of its own. Your team works in its
        dashboard, and your apps reach it through a binding, with no API key to keep.
      </p>
      <dl className="mt-4 flex flex-col border-t border-border">
        {ROLES.map((role) => (
          <div
            key={role.who}
            className="flex flex-col gap-1 border-b border-border py-4 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="w-[140px] shrink-0 text-sm leading-5 font-medium">{role.who}</dt>
            <dd className="text-[15px] leading-[22px] text-muted-foreground">{role.text}</dd>
          </div>
        ))}
      </dl>
    </div>
    <Topology />
  </section>
);
