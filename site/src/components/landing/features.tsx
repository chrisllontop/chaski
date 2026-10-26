import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ArrowRightIcon, BellIcon, GlobeIcon, MailIcon, PhoneIcon } from '../icons';
import { Code, Liquid } from './code';
import { rpcSample } from './samples';
import { StatusPill } from './status';

/**
 * A bento cell whose title links to its guide; the link's box covers the cell, so the whole surface
 * is the target while screen readers hear only the title.
 */
const Cell = ({
  title,
  guide,
  hash,
  text,
  children,
  className = '',
  delay,
  footer,
}: {
  title: string;
  guide: string;
  hash?: string;
  text: string;
  children: ReactNode;
  className?: string;
  delay: string;
  footer?: ReactNode;
}) => (
  <article
    className={`group relative bg-background p-6 transition-colors duration-300 hover:bg-raised has-[:focus-visible]:bg-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-signal sm:p-8 ${className}`}
  >
    <div data-reveal="" className={`flex h-full flex-col justify-between gap-10 ${delay}`}>
      {children}
      <div className="flex items-end justify-between gap-10">
        <div className="flex max-w-[520px] flex-col gap-2">
          <h3 className="cell-title">
            <Link
              to="/docs/$"
              params={{ _splat: guide }}
              hash={hash}
              className="inline-flex items-center gap-2 after:absolute after:inset-0 focus-visible:outline-none"
            >
              {title}
              <ArrowRightIcon
                size={18}
                className="text-signal opacity-0 transition-[opacity,translate] duration-200 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 motion-safe:-translate-x-1.5 motion-safe:group-hover:translate-x-0 motion-safe:group-has-[:focus-visible]:translate-x-0"
              />
            </Link>
          </h3>
          <p className="cell-text">{text}</p>
        </div>
        {footer}
      </div>
    </div>
  </article>
);

const CHANNELS = [
  {
    icon: <MailIcon size={20} strokeWidth={1.5} />,
    name: 'Email',
    via: 'From your domain',
    status: 'Opened',
    time: '1.2 s',
  },
  {
    icon: <GlobeIcon size={20} strokeWidth={1.5} />,
    name: 'Web push',
    via: 'VAPID, any browser',
    status: 'Sent',
    time: '640 ms',
  },
  {
    icon: <PhoneIcon size={20} strokeWidth={1.5} />,
    name: 'APNs',
    via: 'iOS and macOS',
    status: 'Sent',
    time: '410 ms',
  },
  {
    icon: <BellIcon size={20} strokeWidth={1.5} />,
    name: 'In-app',
    via: 'A live feed per user',
    status: 'Sent',
    time: '310 ms',
  },
];

const ChannelsDetail = () => (
  <ul
    className="-mt-2 grid grid-cols-2 border-b border-border sm:grid-cols-4"
    aria-label="Channels"
  >
    {CHANNELS.map((channel, index) => (
      <li
        key={channel.name}
        className={[
          'flex flex-col gap-3.5 border-border py-6',
          index % 2 === 1 ? 'border-l pl-5' : 'pr-5',
          index >= 2 ? 'max-sm:border-t' : '',
          index === 2 ? 'sm:border-l sm:pl-5' : '',
          index === 1 || index === 2 ? 'sm:pr-5' : '',
        ].join(' ')}
      >
        <span
          className={`w-max motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:-translate-y-0.5 ${['', 'delay-[40ms]', 'delay-[80ms]', 'delay-[120ms]'][index]}`}
        >
          {channel.icon}
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[15px] leading-5 font-medium">{channel.name}</p>
          <p className="font-mono text-xs leading-[18px] text-muted-foreground">{channel.via}</p>
        </div>
        <p className="mt-1.5 flex items-center gap-2">
          <StatusPill tone={channel.status === 'Opened' ? 'info' : 'success'}>
            {channel.status}
          </StatusPill>
          <span className="font-mono text-xs leading-4 text-muted-foreground">{channel.time}</span>
        </p>
      </li>
    ))}
  </ul>
);

const TemplateDetail = () => (
  <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card px-5 py-[18px] transition-colors duration-300 group-hover:border-white/14">
    <p className="font-mono text-xs leading-4 text-muted-foreground/70">payment_received · email</p>
    <pre className="code overflow-x-auto text-[12.5px] leading-5">
      <code>
        Payment of <Liquid>{'{{ amount }}'}</Liquid> received
      </code>
    </pre>
    <pre className="code overflow-x-auto text-[12.5px] leading-5 text-muted-foreground">
      <code>
        Hi <Liquid>{'{{ recipient.name }}'}</Liquid>,{'\n'}we got it on{' '}
        <Liquid>{'{{ paid_on }}'}</Liquid>.
      </code>
    </pre>
  </div>
);

const SCHEDULES = [
  { day: 'Tue', time: '09:00', type: 'trial_ending', due: 'in 14 h', closer: 'in 13 h' },
  { day: 'Fri', time: '18:30', type: 'invoice_due', due: 'in 4 d' },
  { day: 'Nov 30', time: '12:00', type: 'renewal_notice', due: 'in 35 d' },
];

const SchedulesDetail = () => (
  <ul className="flex flex-col" aria-label="Scheduled sends">
    {SCHEDULES.map((schedule, index) => (
      <li
        key={schedule.type}
        className={`flex items-center gap-3.5 py-3 ${index < SCHEDULES.length - 1 ? 'border-b border-border' : ''}`}
      >
        <p className="flex w-16 shrink-0 flex-col">
          <span className="font-mono text-xs leading-4 text-muted-foreground">{schedule.day}</span>
          <span className="text-[15px] leading-5 font-medium">{schedule.time}</span>
        </p>
        <span className="grow font-mono text-[12.5px] leading-[18px]">{schedule.type}</span>
        {schedule.closer ? (
          // The next send ticks closer on hover; screen readers keep the first value.
          <span className="grid font-mono text-xs leading-4 text-signal">
            <span className="col-start-1 row-start-1 transition-opacity duration-300 group-hover:opacity-0">
              {schedule.due}
            </span>
            <span
              className="col-start-1 row-start-1 text-right opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden="true"
            >
              {schedule.closer}
            </span>
          </span>
        ) : (
          <span className="font-mono text-xs leading-4 text-muted-foreground">{schedule.due}</span>
        )}
      </li>
    ))}
  </ul>
);

const RETRY_EVENTS = [
  { dot: 'bg-muted-foreground', text: 'Queued', at: '0 s' },
  { dot: 'bg-destructive', text: 'Failed, provider returned 503', at: '0.4 s' },
  { dot: 'bg-signal', text: 'Retried with backoff', at: '+1 min' },
  { dot: 'bg-success', text: 'Sent', at: '1 min 2 s' },
];

const RetriesDetail = () => (
  <ol data-play="" className="relative flex flex-col pt-1" aria-label="A delivery that failed once">
    <span
      className="play-line absolute top-4 left-[3px] h-[116px] w-px origin-top bg-foreground/22"
      aria-hidden="true"
    />
    {RETRY_EVENTS.map((event, index) => (
      <li key={event.text} className="flex h-[38px] items-center gap-3.5">
        <span
          className={`play-item relative size-[7px] shrink-0 rounded-full ${event.dot} ${['[animation-delay:150ms]', '[animation-delay:400ms]', '[animation-delay:650ms]', '[animation-delay:900ms]'][index]}`}
          aria-hidden="true"
        />
        <span
          className={`play-item grow text-sm leading-5 ${['[animation-delay:150ms]', '[animation-delay:400ms]', '[animation-delay:650ms]', '[animation-delay:900ms]'][index]}`}
        >
          {event.text}
        </span>
        <span className="font-mono text-xs leading-4 text-muted-foreground">{event.at}</span>
      </li>
    ))}
  </ol>
);

const Switch = ({ on, hoverOn = false }: { on: boolean; hoverOn?: boolean }) => (
  <span
    className={`flex h-[18px] w-[30px] shrink-0 items-center rounded-full p-0.5 transition-colors duration-300 ${on ? 'bg-foreground' : 'bg-accent'} ${hoverOn ? 'group-hover:bg-foreground' : ''}`}
    role="img"
    aria-label={on ? 'On' : 'Off'}
  >
    <span
      className={`size-3.5 rounded-full transition-[translate,background-color] duration-300 ${on ? 'translate-x-3 bg-background' : 'bg-muted-foreground'} ${hoverOn ? 'group-hover:translate-x-3 group-hover:bg-background' : ''}`}
    />
  </span>
);

const PreferencesDetail = () => (
  <ul className="flex flex-col" aria-label="A user’s preferences">
    {[
      { channel: 'Email', on: true },
      { channel: 'Web push', on: false },
      { channel: 'In-app', on: true },
    ].map((row) => (
      <li key={row.channel} className="flex h-[42px] items-center border-b border-border">
        <span className="grow text-sm leading-5">{row.channel}</span>
        <Switch on={row.on} hoverOn={!row.on} />
      </li>
    ))}
    <li className="flex h-[42px] items-center gap-2">
      <span className="grow text-sm leading-5 text-muted-foreground">Muted</span>
      <span className="flex h-[22px] items-center rounded-md border border-border px-2 font-mono text-xs leading-4 text-muted-foreground">
        weekly_digest
      </span>
    </li>
  </ul>
);

const RpcDetail = () => (
  <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card px-5 py-[18px] transition-colors duration-300 group-hover:border-white/14">
    <p className="font-mono text-xs leading-4 text-muted-foreground/70">
      orders-worker · src/index.ts
    </p>
    <Code className="overflow-x-auto text-[12.5px] leading-5">{rpcSample}</Code>
  </div>
);

const HEALTH = [
  { type: 'payment_received', label: 'Healthy', tone: 'bg-success', text: 'text-muted-foreground' },
  { type: 'trial_ending', label: 'Healthy', tone: 'bg-success', text: 'text-muted-foreground' },
  {
    type: 'order_shipped · push',
    label: 'At risk',
    tone: 'bg-warning',
    text: 'text-warning',
  },
];

const LatencyDetail = () => (
  <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-12">
    <dl className="flex shrink-0 gap-8">
      <div className="flex flex-col gap-1.5">
        <dt className="font-mono text-xs leading-4 text-muted-foreground">To deliver · p50</dt>
        <dd className="text-4xl leading-10 font-medium tracking-[-0.03em]">1.7 s</dd>
      </div>
      <div className="flex flex-col gap-1.5">
        <dt className="font-mono text-xs leading-4 text-muted-foreground">p95</dt>
        <dd className="text-4xl leading-10 font-medium tracking-[-0.03em]">3.1 s</dd>
      </div>
    </dl>
    <ul
      className="flex grow flex-col border-border sm:border-l sm:pl-10"
      aria-label="Health by type"
    >
      {HEALTH.map((row) => (
        <li key={row.type} className="flex h-[30px] items-center gap-2.5">
          <span className="grow font-mono text-[12.5px] leading-[18px]">{row.type}</span>
          <span
            className={`relative size-1.5 shrink-0 rounded-full ${row.tone}`}
            aria-hidden="true"
          />
          <span className={`w-14 shrink-0 text-[13px] leading-[18px] ${row.text}`}>
            {row.label}
          </span>
        </li>
      ))}
    </ul>
  </div>
);

export const Features = () => (
  <section
    id="features"
    className="wrap flex flex-col gap-14 pt-32 lg:pt-40"
    aria-labelledby="features-title"
  >
    <div
      data-reveal=""
      className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-20"
    >
      <div className="flex max-w-[640px] flex-col gap-5">
        <p className="kicker">What it does</p>
        <h2 id="features-title" className="h2">
          Everything a notification needs, on your account.
        </h2>
      </div>
      <p className="lede max-w-[400px]">
        No vendor between your Worker and your users. The data stays in your database, and every
        send is a row you can open.
      </p>
    </div>

    <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
      <Cell
        title="Four channels, one call"
        guide="channels"
        text="Each type picks its channels. Chaski renders every one, queues it and records what happened, per recipient."
        className="md:col-span-2"
        delay="[--reveal-delay:0ms]"
        footer={
          <p className="font-mono text-xs leading-[18px] text-muted-foreground max-sm:hidden">
            chaski.send()
          </p>
        }
      >
        <ChannelsDetail />
      </Cell>
      <Cell
        title="Liquid templates"
        guide="templates"
        text="One per channel, edited in the dashboard with a live preview. Export them as JSON and import them anywhere."
        delay="[--reveal-delay:70ms]"
      >
        <TemplateDetail />
      </Cell>
      <Cell
        title="Scheduled sends"
        guide="scheduling"
        text="Pick a time with its offset, and it waits through deploys. Schedule the same key again and it moves instead of doubling."
        delay="[--reveal-delay:140ms]"
      >
        <SchedulesDetail />
      </Cell>
      <Cell
        title="Retries and replay"
        guide="sending"
        hash="retries"
        text="Temporary failures back off and try again. Permanent ones stop at once, and dead letters replay from the dashboard."
        delay="[--reveal-delay:210ms]"
      >
        <RetriesDetail />
      </Cell>
      <Cell
        title="Preferences"
        guide="preferences"
        text="Your users turn channels off and mute types from your own settings page. Chaski checks before every send."
        delay="[--reveal-delay:280ms]"
      >
        <PreferencesDetail />
      </Cell>
      <Cell
        title="From your other Workers"
        guide="other-workers"
        text="Export ChaskiEntrypoint, and any Worker with a service binding gets the same API over RPC."
        className="md:col-span-2 lg:col-span-1"
        delay="[--reveal-delay:350ms]"
      >
        <RpcDetail />
      </Cell>
      <Cell
        title="Latency and health, per type"
        guide="dashboard"
        text="How long each send takes to reach the provider, and which types are failing, before your users tell you."
        className="md:col-span-2"
        delay="[--reveal-delay:420ms]"
      >
        <LatencyDetail />
      </Cell>
    </div>
  </section>
);
