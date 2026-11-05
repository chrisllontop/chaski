import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useInViewAttribute, useMotionAllowed } from '~/lib/motion';
import { highlight } from './code';
import { appSample, deploySample, initSample } from './samples';
import { playback, Terminal } from './terminal';

// A source file's lines slide in one after another, this far apart.
const CASCADE = 28;
const CASCADE_END = CASCADE * appSample.split('\n').length + 420;

// A step lasts while its file plays, then leaves time to read it: 6 s at least.
const stepLength = (played: number) => Math.max(6000, played + 3000);

const FILES = [
  { id: 'init', name: 'npx chaskijs init', code: initSample, terminal: true },
  { id: 'deploy', name: 'npx chaskijs deploy', code: deploySample, terminal: true },
  { id: 'app', name: 'app/src/index.ts', code: appSample, terminal: false },
].map((file) => ({
  ...file,
  duration: stepLength(file.terminal ? playback(file.code).end : CASCADE_END),
}));

const STEPS = [
  {
    title: 'Create it',
    text: 'One command writes the project in a folder of your repository or in a new one, and installs it, ready to run locally.',
  },
  {
    title: 'Deploy it',
    text: 'It shows what it will create on your Cloudflare account, a database and its queues, and deploys once you say yes. Its dashboard opens for your team only, and the channels are set up there.',
  },
  {
    title: 'Connect your app',
    text: 'Bind your app to it and mount the routes your frontend reads the feed through. Then one call fans out to email, push and the in-app feed, with retries.',
  },
];

const SourceFile = ({ code, playing }: { code: string; playing: boolean }) => {
  const rows = code.split('\n').map((text, index) => ({ text, number: index + 1 }));
  const at = (number: number) =>
    playing ? ({ '--at': `${(number - 1) * CASCADE}ms` } as CSSProperties) : undefined;
  return (
    <>
      <pre
        className={`code text-right text-muted-foreground/60 select-none ${playing ? 'tl-playing' : ''}`}
        aria-hidden="true"
      >
        {rows.map((row) => (
          <span key={row.number} className="tl-row" style={at(row.number)}>
            {row.number}
          </span>
        ))}
      </pre>
      <pre className={`code ${playing ? 'tl-playing' : ''}`}>
        <code>
          {rows.map((row) => (
            <span key={row.number} className="tl-row" style={at(row.number)}>
              {highlight(row.text)}
            </span>
          ))}
        </code>
      </pre>
    </>
  );
};

const TAB_KEYS: Record<string, (index: number) => number> = {
  ArrowRight: (index) => (index + 1) % FILES.length,
  ArrowLeft: (index) => (index - 1 + FILES.length) % FILES.length,
  Home: () => 0,
  End: () => FILES.length - 1,
};

export const HowItWorks = () => {
  const section = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const motion = useMotionAllowed();
  const [active, setActive] = useState(1);
  const [stopped, setStopped] = useState(false);
  const autoplay = motion && !stopped;
  // The steps and the playback wait until most of the panel shows, so the command is typed in view.
  useInViewAttribute(section, panel, 0.3);

  // Autoplay tells the story from the first step; the prerendered frame shows the second.
  useEffect(() => {
    if (motion) setActive(0);
  }, [motion]);

  // On a phone the tab names overflow their bar. Scroll the bar alone, never the page, so the open
  // tab reads whole while the steps above advance.
  useEffect(() => {
    const tab = tabs.current[active];
    const bar = tab?.parentElement;
    if (!tab || !bar) return;
    const inset = Number.parseFloat(getComputedStyle(bar).paddingLeft);
    const box = bar.getBoundingClientRect();
    const { left, right } = tab.getBoundingClientRect();
    const by =
      left < box.left + inset
        ? left - box.left - inset
        : right > box.right - inset
          ? right - box.right + inset
          : 0;
    if (by) bar.scrollBy({ left: by, behavior: motion ? 'smooth' : 'auto' });
  }, [active, motion]);

  const choose = (index: number) => {
    setStopped(true);
    setActive(index);
  };

  const onTabKey = (event: KeyboardEvent) => {
    const next = TAB_KEYS[event.key]?.(active);
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
    tabs.current[next]?.focus();
  };

  return (
    <section
      ref={section}
      id="how-it-works"
      data-reveal=""
      className={`wrap grid grid-cols-1 gap-14 pt-24 lg:grid-cols-[460px_minmax(0,660px)] lg:items-start lg:justify-between lg:gap-20 lg:pt-[120px] ${autoplay ? 'steps-auto' : ''}`}
      aria-labelledby="how-title"
    >
      <div className="flex flex-col gap-5">
        <p className="kicker">How it works</p>
        <h2 id="how-title" className="h2">
          Deploy it next to your app.
        </h2>
        <p className="lede">
          Chaski is a Worker of its own, on your account. Two commands create and deploy it, and
          your app sends to it from anywhere in its code.
        </p>
        <ol className="flex flex-col pt-5">
          {STEPS.map((step, index) => {
            const current = index === active;
            return (
              <li key={step.title} className="relative border-l-2 border-border">
                <button
                  type="button"
                  onClick={() => choose(index)}
                  aria-controls={`file-${FILES[index]?.id}`}
                  aria-current={current ? 'step' : undefined}
                  className="group flex w-full cursor-pointer gap-4 py-[18px] pl-[18px] text-left focus-visible:outline-offset-0"
                >
                  <span
                    className={`w-5 shrink-0 font-mono text-[13px] leading-[22px] transition-colors ${current ? 'text-signal' : 'text-muted-foreground'}`}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="flex flex-col gap-1">
                    <span
                      className={`text-base leading-[22px] font-medium transition-colors ${current ? 'text-foreground' : 'text-foreground/60 group-hover:text-foreground'}`}
                    >
                      {step.title}
                    </span>
                    <span
                      className={`text-sm leading-[22px] text-pretty transition-colors ${current ? 'text-muted-foreground' : 'text-muted-foreground/75'}`}
                    >
                      {step.text}
                    </span>
                  </span>
                </button>
                {current ? (
                  <span
                    key={autoplay ? `fill-${index}` : 'still'}
                    className={`absolute top-0 -left-0.5 h-full w-0.5 origin-top bg-signal ${autoplay ? 'step-fill' : ''}`}
                    style={
                      autoplay ? { animationDuration: `${FILES[index]?.duration}ms` } : undefined
                    }
                    onAnimationEnd={() => setActive((index + 1) % STEPS.length)}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div
        ref={panel}
        className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card"
      >
        <div
          role="tablist"
          aria-label="Files"
          className="flex h-11 items-end gap-1 overflow-x-auto border-b border-border px-3"
        >
          {FILES.map((file, index) => (
            <button
              key={file.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`tab-${file.id}`}
              aria-controls={`file-${file.id}`}
              aria-selected={index === active}
              tabIndex={index === active ? 0 : -1}
              onClick={() => choose(index)}
              onKeyDown={onTabKey}
              className="flex h-[43px] shrink-0 cursor-pointer items-center border-b-2 border-transparent px-2.5 font-mono text-xs leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-[-2px] aria-selected:border-signal aria-selected:text-foreground"
            >
              {file.name}
            </button>
          ))}
        </div>
        <div className="min-h-[638px]">
          {FILES.map((file, index) => (
            <div
              key={file.id}
              id={`file-${file.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${file.id}`}
              hidden={index !== active}
              className="overflow-x-auto focus-visible:outline-offset-[-2px]"
            >
              <div
                key={index === active ? 'shown' : 'hidden'}
                className="flex w-max gap-5 px-5 pt-5 pb-6"
              >
                {file.terminal ? (
                  <Terminal transcript={file.code} playing={motion && index === active} />
                ) : (
                  <SourceFile code={file.code} playing={motion && index === active} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
