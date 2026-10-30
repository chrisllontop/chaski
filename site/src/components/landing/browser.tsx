import { BellIcon } from '../icons';

const FEED = [
  {
    title: 'Payment of $15.00 received',
    body: 'Thanks, Ana. Your receipt is on its way to your inbox.',
    at: 'now',
    unread: true,
    newest: true,
  },
  {
    title: 'Your trial ends tomorrow',
    body: 'Pick a plan to keep your three projects running.',
    at: '2 h',
    unread: true,
  },
  { title: 'Order #1042 shipped', body: 'It should reach Lima by Thursday.', at: 'Mon' },
];

const PACKAGES = [
  { name: 'chaskijs', text: 'userRoutes(), the routes your app mounts' },
  { name: 'chaskijs/client', text: 'The feed, unread count, push and preferences' },
  { name: 'chaskijs/sw', text: 'Shows web push in your service worker' },
  { name: 'chaskijs/react', text: 'useFeed, useUnreadCount, usePush and usePreferences' },
];

const BellMock = () => (
  <div
    data-play=""
    data-reveal=""
    className="relative h-[440px] overflow-hidden rounded-2xl border border-border bg-card max-lg:order-last"
    aria-hidden="true"
  >
    <div className="flex h-[60px] items-center justify-between border-b border-border px-5">
      <div className="flex items-center gap-6">
        <span className="text-[15px] leading-5 font-semibold tracking-[-0.01em]">My App</span>
        <span className="text-[13px] leading-[18px] text-muted-foreground max-sm:hidden">
          Projects
        </span>
        <span className="text-[13px] leading-[18px] text-muted-foreground max-sm:hidden">
          Billing
        </span>
      </div>
      <div className="flex items-center gap-3.5">
        <span className="relative flex size-[34px] items-center justify-center rounded-lg bg-accent">
          <BellIcon />
          <span className="absolute -top-[5px] -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-card bg-signal px-[5px] text-[11px] leading-3 font-semibold text-signal-ink">
            <span className="badge-prev col-start-1 row-start-1">1</span>
            <span className="badge-next col-start-1 row-start-1">2</span>
          </span>
        </span>
        <span className="flex size-[30px] items-center justify-center rounded-full bg-[#2a2a2a] text-xs leading-4 font-medium">
          AR
        </span>
      </div>
    </div>
    <div className="flex flex-col gap-3.5 px-6 py-7 opacity-50">
      <span className="text-xl leading-7 font-semibold tracking-[-0.02em]">Projects</span>
      <span className="h-2.5 w-[180px] rounded bg-accent" />
      <span className="mt-3.5 flex flex-col gap-2.5">
        <span className="h-14 rounded-[10px] border border-border" />
        <span className="h-14 rounded-[10px] border border-border" />
        <span className="h-14 rounded-[10px] border border-border" />
        <span className="h-14 rounded-[10px] border border-border" />
      </span>
    </div>
    <div className="absolute top-[68px] right-4 left-4 flex flex-col overflow-hidden rounded-xl border border-foreground/12 bg-popover shadow-[0_24px_48px_-12px_rgb(0_0_0/0.6)] sm:left-auto sm:w-[372px]">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <span className="text-sm leading-5 font-medium">Notifications</span>
        <span className="text-[13px] leading-[18px] text-muted-foreground">Mark all read</span>
      </div>
      {FEED.map((item) => (
        <div
          key={item.title}
          className={`flex gap-3 border-b border-border px-4 py-3.5 ${item.newest ? 'play-drop bg-signal/6' : ''}`}
        >
          <span className="w-2 shrink-0 pt-[7px]">
            {item.unread ? <span className="block size-[7px] rounded-full bg-signal" /> : null}
          </span>
          <span className="flex grow flex-col gap-[3px]">
            <span className="flex justify-between gap-3">
              <span
                className={`text-sm leading-5 font-medium ${item.unread ? '' : 'text-muted-foreground'}`}
              >
                {item.title}
              </span>
              <span className="shrink-0 font-mono text-[11.5px] leading-5 text-muted-foreground">
                {item.at}
              </span>
            </span>
            <span
              className={`text-[13px] leading-[19px] ${item.unread ? 'text-muted-foreground' : 'text-muted-foreground/75'}`}
            >
              {item.body}
            </span>
          </span>
        </div>
      ))}
      <div className="flex h-10 items-center gap-2 px-4">
        <span className="size-1.5 rounded-full bg-success" />
        <span className="font-mono text-[11.5px] leading-4 text-muted-foreground">
          Live · useFeed()
        </span>
      </div>
    </div>
  </div>
);

export const Browser = () => (
  <section
    id="browser"
    className="wrap grid grid-cols-1 items-center gap-16 pt-32 lg:grid-cols-[560px_1fr] lg:gap-24 lg:pt-40"
    aria-labelledby="browser-title"
  >
    <BellMock />
    <div data-reveal="" className="flex flex-col gap-5 [--reveal-delay:70ms]">
      <p className="kicker">In the browser</p>
      <h2 id="browser-title" className="h2">
        Draw your bell. Chaski keeps it live.
      </h2>
      <p className="lede">
        Your frontend reads the signed-in user’s feed through the routes your app mounts, and the
        hooks update the bell over a WebSocket the moment a send lands.
      </p>
      <dl className="mt-4 flex flex-col border-t border-border">
        {PACKAGES.map((entry) => (
          <div
            key={entry.name}
            className="flex flex-col gap-1 border-b border-border py-4 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="w-[140px] shrink-0 font-mono text-sm leading-5">{entry.name}</dt>
            <dd className="text-[15px] leading-[22px] text-muted-foreground">{entry.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  </section>
);
