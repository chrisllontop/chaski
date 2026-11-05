import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from '../icons';

const OPTIONS = [
  {
    title: 'Build it yourself',
    rows: [
      { label: 'You run', text: 'Queues, retries, template editing and every provider’s rules.' },
      {
        label: 'You pay',
        text: 'Your time, before the first send and after each provider change.',
      },
      { label: 'Your data', text: 'Yours, in tables you design and keep.' },
      { label: 'The dashboard', text: 'One you build when support asks where an email went.' },
    ],
    featured: false,
  },
  {
    title: 'Rent a vendor',
    rows: [
      { label: 'You run', text: 'An SDK and an API key in your app.' },
      {
        label: 'You pay',
        text: 'A subscription that grows with volume, and a migration if you leave.',
      },
      { label: 'Your data', text: 'Their database, under their retention.' },
      { label: 'The dashboard', text: 'Theirs, with another sign-in for your team.' },
    ],
    featured: false,
  },
  {
    title: 'Run Chaski',
    rows: [
      { label: 'You run', text: 'A Worker of its own next to your app, called over a binding.' },
      { label: 'You pay', text: 'Your Cloudflare bill. No per-notification price.' },
      { label: 'Your data', text: 'Your D1 database, in your account.' },
      {
        label: 'The dashboard',
        text: 'Included, at the Worker’s URL, behind your team’s sign-in.',
      },
    ],
    featured: true,
  },
];

// Spelled out so Tailwind finds each class.
const DELAYS = ['[--reveal-delay:0ms]', '[--reveal-delay:70ms]', '[--reveal-delay:140ms]'];

export const Compare = () => (
  <section
    id="compare"
    className="wrap flex flex-col gap-14 pt-32 lg:pt-40"
    aria-labelledby="compare-title"
  >
    <div
      data-reveal=""
      className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-20"
    >
      <div className="flex max-w-[640px] flex-col gap-5">
        <p className="kicker">The choice</p>
        <h2 id="compare-title" className="h2">
          Build it, rent it, or run it on your account.
        </h2>
      </div>
      <p className="lede max-w-[400px]">
        Notifications are never the product. They are queues, templates, preferences and providers
        that have to work while nobody is watching.
      </p>
    </div>

    <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
      {OPTIONS.map((option, index) => (
        <article
          key={option.title}
          className={`p-6 sm:p-8 ${option.featured ? 'bg-card' : 'bg-background'}`}
        >
          <div data-reveal="" className={`flex flex-col gap-6 ${DELAYS[index]}`}>
            <h3 className="cell-title flex items-center gap-2.5">
              {option.featured ? (
                <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
              ) : null}
              {option.title}
            </h3>
            <dl className="flex flex-col">
              {option.rows.map((row) => (
                <div key={row.label} className="flex flex-col gap-1 border-t border-border py-4">
                  <dt className="font-mono text-xs leading-4 text-muted-foreground">{row.label}</dt>
                  <dd className="text-[15px] leading-[22px]">{row.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </article>
      ))}
    </div>

    <p data-reveal="" className="lede max-w-[640px]">
      Chaski fits apps already on Cloudflare Workers, in the account that will hold it. Email also
      needs Workers Paid and a domain on Email Service.{' '}
      <Link
        to="/docs/$"
        params={{ _splat: 'install' }}
        className="group inline-flex items-center gap-1.5 text-foreground"
      >
        See the requirements
        <ArrowRightIcon className="motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:translate-x-0.5" />
      </Link>
    </p>
  </section>
);
