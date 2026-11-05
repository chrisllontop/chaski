import dashboard from '~/assets/dashboard-overview.webp';
import { LockIcon } from '../icons';

export const ProductShot = () => (
  <section id="dashboard" className="wrap relative" aria-labelledby="dashboard-title">
    <h2 id="dashboard-title" className="sr-only">
      The dashboard
    </h2>
    <figure className="shot-in overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex h-11 items-center justify-center border-b border-border">
        <div className="flex h-[26px] items-center gap-2 rounded-md bg-muted px-3 font-mono text-xs leading-4">
          <LockIcon size={12} className="text-muted-foreground" />
          <span>
            chaski<span className="text-muted-foreground">.example.workers.dev</span>
          </span>
        </div>
      </div>
      <img
        src={dashboard}
        width={2400}
        height={1367}
        alt="Chaski’s dashboard: notifications, sent, success rate and open rate for the last 30 days, deliveries per day, latency and health by type."
        className="block h-auto w-full"
        decoding="async"
        fetchPriority="high"
      />
    </figure>
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] bg-linear-to-b from-transparent to-background lg:h-[220px]"
      aria-hidden="true"
    />
    <p className="relative flex flex-col gap-1 pt-5 text-center sm:flex-row sm:items-baseline sm:justify-between sm:text-left">
      <span className="text-[15px] leading-5 font-medium">The dashboard your team opens</span>
      <span className="text-sm leading-[22px] text-muted-foreground">
        Deliveries per day, latency and the health of each type, before a user reports a missing
        email.
      </span>
    </p>
  </section>
);
