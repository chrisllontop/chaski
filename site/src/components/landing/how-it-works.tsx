import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useInViewAttribute, useMotionAllowed } from '~/lib/motion';
import { highlight } from './code';
import { billingSample, indexSample, wranglerSample } from './samples';

const FILES = [
  { id: 'wrangler', name: 'wrangler.jsonc', code: wranglerSample },
  { id: 'index', name: 'src/index.ts', code: indexSample },
  { id: 'billing', name: 'src/billing.ts', code: billingSample },
];

const STEPS = [
  {
    title: 'Declare the bindings',
    text: 'A database and a queue to start. Add the rest as you need it.',
  },
  {
    title: 'Mount the routes',
    text: 'The dashboard behind the sign-in you choose, and the routes your frontend calls for the signed-in user.',
  },
  {
    title: 'Send',
    text: 'One call fans out to email, push and the in-app feed through your queue, with retries.',
  },
];

const TAB_KEYS: Record<string, (index: number) => number> = {
  ArrowRight: (index) => (index + 1) % FILES.length,
  ArrowLeft: (index) => (index - 1 + FILES.length) % FILES.length,
  Home: () => 0,
  End: () => FILES.length - 1,
};

export const HowItWorks = () => {
  const section = useRef<HTMLElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const motion = useMotionAllowed();
  const [active, setActive] = useState(1);
  const [stopped, setStopped] = useState(false);
  const autoplay = motion && !stopped;
  useInViewAttribute(section);

  // Autoplay tells the story from the first step; the prerendered frame shows the second.
  useEffect(() => {
    if (motion) setActive(0);
  }, [motion]);

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
          Mount it on a route. It ships with your Worker.
        </h2>
        <p className="lede">
          Chaski is a library you mount, not another service. Your Worker hands it the bindings and
          sends from anywhere in your code.
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
                    onAnimationEnd={() => setActive((index + 1) % STEPS.length)}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card">
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
                className={`flex w-max gap-5 px-5 pt-5 pb-6 ${index === active ? 'code-in' : ''}`}
              >
                <pre
                  className="code text-right text-muted-foreground/60 select-none"
                  aria-hidden="true"
                >
                  {file.code
                    .split('\n')
                    .map((_, line) => line + 1)
                    .join('\n')}
                </pre>
                <pre className="code">
                  <code>{highlight(file.code)}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
