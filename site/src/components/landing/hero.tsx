import type { ReactNode } from 'react';
import { DocsButton, InstallChip } from '../actions';
import { BellIcon, MailIcon, PhoneIcon } from '../icons';
import { Code } from './code';
import { sendSample } from './samples';
import { StatusPill } from './status';

const DeliveryRow = ({
  icon,
  channel,
  status,
  meta,
  delay,
}: {
  icon: ReactNode;
  channel: string;
  status: ReactNode;
  meta: string;
  delay: string;
}) => (
  <li
    className={`relay-row relative flex h-11 items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5 ${delay}`}
  >
    <span className="shrink-0 text-muted-foreground">{icon}</span>
    <span className="w-16 shrink-0 text-[13px] leading-[18px]">{channel}</span>
    {status}
    <span className="ml-auto font-mono text-xs leading-4 text-muted-foreground">{meta}</span>
  </li>
);

const RelayCard = () => (
  <figure className="hero-in flex min-w-0 flex-col [animation-delay:320ms]">
    <figcaption className="sr-only">One send, three deliveries</figcaption>
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex h-9 items-center justify-between border-b border-border px-3.5 font-mono text-xs leading-4">
        <span className="text-muted-foreground">src/billing.ts</span>
        <span className="text-signal">send()</span>
      </div>
      <Code className="overflow-x-auto px-4 py-3.5 leading-[21px]">{sendSample}</Code>
    </div>
    <ul className="relative flex flex-col gap-2 pt-5 pl-9">
      <svg
        className="absolute top-0 left-0 text-signal"
        width="36"
        height="166"
        viewBox="0 0 36 166"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path className="draw-path relay-line" pathLength={1} d="M14 0V138" />
        <path
          className="draw-path relay-branch [animation-delay:840ms]"
          pathLength={1}
          d="M14 34Q14 42 22 42H36"
        />
        <path
          className="draw-path relay-branch [animation-delay:1140ms]"
          pathLength={1}
          d="M14 86Q14 94 22 94H36"
        />
        <path
          className="draw-path relay-branch [animation-delay:1440ms]"
          pathLength={1}
          d="M14 138Q14 146 22 146H36"
        />
      </svg>
      <DeliveryRow
        icon={<MailIcon />}
        channel="Email"
        status={<StatusPill tone="success">Sent</StatusPill>}
        meta="1.2 s"
        delay="[animation-delay:1000ms]"
      />
      <DeliveryRow
        icon={<BellIcon />}
        channel="In-app"
        status={<StatusPill tone="success">Sent</StatusPill>}
        meta="310 ms"
        delay="[animation-delay:1300ms]"
      />
      <DeliveryRow
        icon={<PhoneIcon />}
        channel="Push"
        status={
          <StatusPill tone="info" pulse>
            Retrying
          </StatusPill>
        }
        meta="attempt 2 of 6"
        delay="[animation-delay:1600ms]"
      />
    </ul>
  </figure>
);

export const Hero = () => (
  <section
    className="wrap grid grid-cols-1 items-end gap-14 pt-20 pb-16 lg:grid-cols-[minmax(0,696px)_440px] lg:justify-between lg:gap-16 lg:pt-28 lg:pb-[72px]"
    aria-labelledby="hero-title"
  >
    <div className="flex flex-col gap-7">
      <h1
        id="hero-title"
        className="hero-in text-[44px] leading-[46px] font-semibold tracking-[-0.045em] text-balance [animation-delay:80ms] sm:text-6xl sm:leading-[62px] lg:text-[74px] lg:leading-[76px]"
      >
        Notifications that run in a Worker of your own.
      </h1>
      <p className="hero-in max-w-[600px] text-[17px] leading-7 text-pretty text-muted-foreground [animation-delay:160ms] sm:text-[19px] sm:leading-[30px]">
        Email, in-app and push notifications for the web, iOS, macOS, Android and Windows, with
        templates, scheduling, retries and a dashboard. Deploy Chaski next to your app, on your own
        Cloudflare account, and send with one call.
      </p>
      <div className="hero-in flex flex-wrap items-center gap-3 pt-2 [animation-delay:240ms]">
        <DocsButton />
        <InstallChip initial="agent" />
      </div>
    </div>
    <RelayCard />
  </section>
);
