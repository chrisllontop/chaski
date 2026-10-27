import { Link } from '@tanstack/react-router';
import type { MDXComponents } from 'mdx/types';
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useId,
  useRef,
  useState,
} from 'react';
import { docParams } from '~/lib/docs';
import { setupPrompt } from '~/lib/site';
import { CopyStatus, useCopy } from '../copy';
import { CheckIcon, CopyIcon, InfoIcon, TerminalIcon } from '../icons';

const SHELLS = new Set(['bash', 'sh', 'shell', 'zsh']);

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSONC',
  html: 'HTML',
  liquid: 'Liquid',
};

const CopyCode = ({ source, label = 'Copy code' }: { source: () => string; label?: string }) => {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(source())}
      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:size-7"
    >
      {copied ? <CheckIcon size={14} className="text-success" /> : <CopyIcon size={14} />}
      <span className="sr-only">{label}</span>
      <CopyStatus copied={copied} />
    </button>
  );
};

const codeClass =
  'overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-[22px] focus-visible:outline-offset-[-2px] lg:px-5 lg:py-4 lg:text-[13.5px]';

// Inside a tab group the group draws the frame, the tabs and the copy button.
const InTabs = createContext(false);

const Pre = ({
  title,
  children,
  ...props
}: ComponentProps<'pre'> & { 'data-language'?: string }) => {
  const pre = useRef<HTMLPreElement>(null);
  const inTabs = useContext(InTabs);
  const language = props['data-language'] ?? '';
  const body = (
    <pre ref={pre} {...props} className={codeClass}>
      {children}
    </pre>
  );
  if (inTabs) return body;
  const shell = SHELLS.has(language);
  return (
    <figure className="code-block">
      <figcaption className="flex h-10 items-center justify-between border-b border-border pr-1.5 pl-3.5 lg:pr-2 lg:pl-4">
        <span className="flex items-center gap-2 font-mono text-xs leading-4 text-muted-foreground">
          {shell && !title ? <TerminalIcon size={13} /> : null}
          {title ?? (shell ? 'Terminal' : (LANGUAGES[language] ?? language))}
        </span>
        <CopyCode source={() => pre.current?.textContent ?? ''} />
      </figcaption>
      {body}
    </figure>
  );
};

// The prompt is prose to paste, so it wraps instead of scrolling like code.
const SetupPrompt = () => (
  <figure className="code-block">
    <figcaption className="flex h-10 items-center justify-between border-b border-border pr-1.5 pl-3.5 lg:pr-2 lg:pl-4">
      <span className="font-mono text-xs leading-4 text-muted-foreground">Setup prompt</span>
      <CopyCode source={() => setupPrompt} label="Copy the setup prompt" />
    </figcaption>
    <pre className={`${codeClass} whitespace-pre-wrap`}>{setupPrompt}</pre>
  </figure>
);

const TabsContext = createContext<{ value: string; select: (value: string) => void; id: string }>({
  value: '',
  select: () => {},
  id: '',
});

const CodeBlockTabs = ({
  defaultValue,
  children,
}: {
  defaultValue: string;
  children: ReactNode;
}) => {
  const [value, setValue] = useState(defaultValue);
  const id = useId();
  return (
    <TabsContext.Provider value={{ value, select: setValue, id }}>
      <div className="code-block">{children}</div>
    </TabsContext.Provider>
  );
};

const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const target = {
    ArrowRight: tabs[(current + 1) % tabs.length],
    ArrowLeft: tabs[(current - 1 + tabs.length) % tabs.length],
    Home: tabs[0],
    End: tabs.at(-1),
  }[event.key];
  if (!target) return;
  event.preventDefault();
  target.focus();
  target.click();
};

const CodeBlockTabsList = ({ children }: { children: ReactNode }) => {
  const list = useRef<HTMLDivElement>(null);
  return (
    <div className="flex h-10 items-end justify-between border-b border-border pr-1.5 pl-2 lg:pr-2 lg:pl-3">
      <div ref={list} role="tablist" className="flex items-end lg:gap-1" onKeyDown={onTabKey}>
        {children}
      </div>
      <div className="mb-1 lg:mb-1.5">
        <CopyCode
          source={() =>
            list.current
              ?.closest('.code-block')
              ?.querySelector('[role="tabpanel"]:not([hidden]) pre')?.textContent ?? ''
          }
        />
      </div>
    </div>
  );
};

const CodeBlockTabsTrigger = ({ value, children }: { value: string; children: ReactNode }) => {
  const tabs = useContext(TabsContext);
  const selected = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${tabs.id}-tab-${value}`}
      aria-controls={`${tabs.id}-panel-${value}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => tabs.select(value)}
      className="flex h-[39px] cursor-pointer items-center border-b-2 border-transparent px-2 font-mono text-xs leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-[-2px] aria-selected:border-signal aria-selected:text-foreground"
    >
      {children}
    </button>
  );
};

const CodeBlockTab = ({ value, children }: { value: string; children: ReactNode }) => {
  const tabs = useContext(TabsContext);
  return (
    <div
      role="tabpanel"
      id={`${tabs.id}-panel-${value}`}
      aria-labelledby={`${tabs.id}-tab-${value}`}
      hidden={tabs.value !== value}
    >
      <InTabs.Provider value={true}>{children}</InTabs.Provider>
    </div>
  );
};

const Callout = ({ title, children }: { title?: ReactNode; children: ReactNode }) => (
  <aside className="callout">
    <InfoIcon size={18} className="mt-[3px] shrink-0 text-signal" />
    <div className="flex min-w-0 flex-col gap-0.5">
      {title ? <p className="callout-title">{title}</p> : null}
      <div className="callout-body">{children}</div>
    </div>
  </aside>
);

const Anchor = ({ href = '', children, ...props }: ComponentProps<'a'>) => {
  if (href.startsWith('/docs')) {
    const [path = '', hash] = href.split('#');
    return (
      <Link to="/docs/$" params={docParams(path)} hash={hash} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
};

export const mdxComponents = {
  a: Anchor,
  pre: Pre,
  Callout,
  SetupPrompt,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
  CodeBlockTab,
} satisfies MDXComponents;
