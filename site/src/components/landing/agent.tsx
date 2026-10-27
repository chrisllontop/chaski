import type { ReactNode } from 'react';
import { setupPrompt } from '~/lib/site';
import { CopyStatus, useCopy } from '../copy';
import { CheckIcon, CopyIcon, TerminalIcon, TickIcon } from '../icons';

const STEPS = [
  { text: 'Read the Chaski skill and its setup guide', meta: 'chaski.sh/skill' },
  { text: 'Read the Worker and its session middleware', meta: 'src/index.ts' },
  { text: 'Declared a database and a queue', meta: 'wrangler.jsonc' },
  { text: 'Mounted the dashboard, for admins only', meta: '/admin/notifications' },
  { text: 'Created the tables locally', meta: '--local' },
  { text: 'Sent a welcome email in dry run', meta: 'delivered', metaClass: 'text-success' },
];

const ASKS = { text: 'Deploy to your account, once you say so', meta: 'asks first' };

// One class per step, spelled out so Tailwind finds them: each row slides in, then its mark pops.
const ROW_DELAYS = [
  '[animation-delay:200ms]',
  '[animation-delay:500ms]',
  '[animation-delay:800ms]',
  '[animation-delay:1100ms]',
  '[animation-delay:1400ms]',
  '[animation-delay:1700ms]',
  '[animation-delay:2000ms]',
];
const MARK_DELAYS = [
  '[animation-delay:350ms]',
  '[animation-delay:650ms]',
  '[animation-delay:950ms]',
  '[animation-delay:1250ms]',
  '[animation-delay:1550ms]',
  '[animation-delay:1850ms]',
  '[animation-delay:2150ms]',
];

const ALSO_TRY = [
  'Audit the notifications this app sends',
  'Move the receipt email onto Chaski',
  'Add the bell to our React app',
  'Why didn’t this push go out?',
];

const Step = ({
  index,
  mark,
  text,
  meta,
  textClass = '',
  metaClass = 'text-muted-foreground',
}: {
  index: number;
  mark: ReactNode;
  text: string;
  meta: string;
  textClass?: string;
  metaClass?: string;
}) => (
  <li
    className={`play-row flex min-h-[34px] items-start gap-3 py-[7px] sm:items-center sm:py-0 ${ROW_DELAYS[index]}`}
  >
    <span
      className={`play-item flex size-5 shrink-0 items-center justify-center ${MARK_DELAYS[index]}`}
    >
      {mark}
    </span>
    <span className="flex min-w-0 grow flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className={`text-sm leading-5 ${textClass}`}>{text}</span>
      <span className={`shrink-0 font-mono text-xs leading-4 sm:text-right ${metaClass}`}>
        {meta}
      </span>
    </span>
  </li>
);

const AgentSession = () => (
  <figure
    data-play=""
    data-reveal=""
    className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card max-lg:order-last"
  >
    <figcaption className="sr-only">A coding agent setting Chaski up from the prompt</figcaption>
    <div className="flex h-11 items-center justify-between border-b border-border px-4">
      <span className="flex items-center gap-2.5 font-mono text-[13px] leading-4 text-muted-foreground">
        <TerminalIcon />
        acme-api
      </span>
      <span className="font-mono text-xs leading-4 text-signal">agent</span>
    </div>
    <div className="flex flex-col gap-[22px] p-5 sm:p-6">
      <p className="flex items-start gap-3 rounded-lg bg-muted px-3.5 py-3 text-sm leading-[21px]">
        <span className="shrink-0 font-mono text-signal" aria-hidden="true">
          ›
        </span>
        <span className="min-w-0">{setupPrompt}</span>
      </p>
      <ol className="flex flex-col gap-1">
        {STEPS.map((step, index) => (
          <Step
            key={step.text}
            index={index}
            mark={<TickIcon className="text-success" />}
            text={step.text}
            meta={step.meta}
            metaClass={step.metaClass}
          />
        ))}
        <Step
          index={STEPS.length}
          mark={<span className="size-[7px] rounded-full bg-signal" />}
          text={ASKS.text}
          meta={ASKS.meta}
          textClass="text-muted-foreground"
          metaClass="text-signal"
        />
      </ol>
    </div>
    <div className="flex flex-col gap-3 border-t border-border px-5 pt-[18px] pb-[22px] sm:px-6">
      <p className="font-mono text-xs leading-4 text-muted-foreground">Also try</p>
      <ul className="flex flex-wrap gap-2">
        {ALSO_TRY.map((prompt) => (
          <li
            key={prompt}
            className="rounded-full border border-border px-3 py-1.5 text-[13px] leading-[18px]"
          >
            {prompt}
          </li>
        ))}
      </ul>
    </div>
  </figure>
);

const PromptBox = () => {
  const { copied, copy } = useCopy();
  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="flex h-[38px] items-center justify-between border-b border-border pr-1.5 pl-3.5">
        <span className="font-mono text-xs leading-4 text-muted-foreground">Setup prompt</span>
        <button
          type="button"
          onClick={() => copy(setupPrompt)}
          aria-label="Copy the setup prompt"
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13px] leading-4 font-medium text-primary-foreground transition-colors duration-150 hover:bg-white focus-visible:outline-offset-0 motion-safe:transition-[background-color,scale] motion-safe:active:scale-[.98]"
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          Copy
          <CopyStatus copied={copied} />
        </button>
      </div>
      <p className="px-4 pt-3.5 pb-4 font-mono text-[13px] leading-[21px]">{setupPrompt}</p>
    </div>
  );
};

export const Agent = () => (
  <section
    id="agent"
    className="wrap grid grid-cols-1 gap-14 pt-32 lg:grid-cols-[minmax(0,640px)_minmax(0,480px)] lg:items-center lg:justify-between lg:gap-16 lg:pt-40 xl:gap-20"
    aria-labelledby="agent-title"
  >
    <AgentSession />
    <div data-reveal="" className="flex flex-col gap-5 [--reveal-delay:70ms]">
      <p className="kicker">With your agent</p>
      <h2 id="agent-title" className="h2">
        Or let your agent
        <br />
        mount it.
      </h2>
      <p className="lede">
        One prompt, any coding agent. It follows the same guide you would, and asks before it
        touches your Cloudflare account.
      </p>
      <ol className="flex flex-col gap-5 pt-3">
        <li className="flex items-baseline gap-3">
          <span className="w-5 shrink-0 font-mono text-[13px] leading-[22px] text-signal">01</span>
          <div className="flex min-w-0 grow flex-col gap-3">
            <p className="text-base leading-[22px] font-medium">Copy the prompt</p>
            <PromptBox />
          </div>
        </li>
        <li className="flex items-baseline gap-3">
          <span className="w-5 shrink-0 font-mono text-[13px] leading-[22px] text-signal">02</span>
          <div className="flex flex-col gap-0.5">
            <p className="text-base leading-[22px] font-medium">Paste it into your agent</p>
            <p className="text-sm leading-[22px] text-muted-foreground">
              Claude Code, Codex, Cursor, or any agent that can read a URL.
            </p>
          </div>
        </li>
      </ol>
      <div className="flex flex-col gap-1.5 border-t border-border pt-[18px]">
        <p className="text-sm leading-[22px] text-muted-foreground">
          Want it in your repo, for audits and fixes later?
        </p>
        <code className="font-mono text-[13px] leading-5">npx skills add chrisllontop/chaski</code>
      </div>
    </div>
  </section>
);
