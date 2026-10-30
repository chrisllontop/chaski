import type { CSSProperties, ReactNode } from 'react';

// The playback's pace, in milliseconds.
const START = 400; // the cursor blinks before the command is typed
const TYPE = 45; // each typed character
const ENTER = 150; // from the last typed character to the output
const THINK = 400; // a question waits before its answer is typed
const ACCEPT = 200; // or before Enter takes its default
const PRINT = 40; // each printed line
const WORK = 700; // a line ending in `…`, while its work runs
const STEP = 420; // each of deploy's `→` steps

// A question waits after its `:` or its `(Y/n)`; what was answered follows.
const ASK = /^((?:\? |\s+Choose ).*(?:\((?:Y\/n|y\/N)\)|:))(?: (\S+))?$/;
const HINT = /\([^)]+\)/g;
const LINK = /https?:\/\/\S+/g;
const NUMBERED = /^(\s+)(\d+\.)( .*)$/;
const COMMAND = /^(\s+)((?:cd|npx|npm|pnpm|yarn|bunx?) .*?)(\s{2,}.*)?$/;
const LIVE = /^(Chaski is live)( at .*)$/;

type Line = {
  text: string;
  kind: 'command' | 'ask' | 'work' | 'step' | 'print';
  prompt: string;
  typed: string;
  at: number;
  typeAt: number;
  done: number;
};

/** Times each line of a transcript as a terminal would print it; at `end` the shell prompts again. */
export const playback = (transcript: string) => {
  let clock = 0;
  const lines = transcript.split('\n').map((text, index): Line => {
    const ask = ASK.exec(text);
    const kind =
      index === 0 && text.startsWith('$ ')
        ? 'command'
        : ask
          ? 'ask'
          : text.endsWith('…')
            ? 'work'
            : text.startsWith('→ ')
              ? 'step'
              : 'print';
    const typed = kind === 'command' ? text.slice(2) : (ask?.[2] ?? '');
    const at = clock;
    const typeAt = at + (kind === 'command' ? START : typed ? THINK : ACCEPT);
    const done =
      kind === 'command' || kind === 'ask'
        ? typeAt + typed.length * TYPE + ENTER
        : at + (kind === 'work' ? WORK : kind === 'step' ? STEP : PRINT);
    clock = done;
    return { text, kind, prompt: ask?.[1] ?? '', typed, at, typeAt, done };
  });
  return { lines, end: clock };
};

const timing = (line: Pick<Line, 'at'> & Partial<Line>) =>
  ({
    '--at': `${line.at}ms`,
    '--type-at': `${line.typeAt ?? line.at}ms`,
    '--typing': `${(line.typed?.length ?? 0) * TYPE}ms`,
    '--chars': String(line.typed?.length ?? 0),
    '--done': `${line.done ?? line.at}ms`,
  }) as CSSProperties;

const mark = (text: string, pattern: RegExp, className: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    nodes.push(
      text.slice(last, match.index),
      <span key={match.index} className={className}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  nodes.push(text.slice(last));
  return nodes;
};

const links = (text: string) => mark(text, LINK, 'text-info');

const Muted = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground">{children}</span>
);

const Cursor = ({ last = false }) => (
  <span className={`tl-cursor ${last ? 'tl-cursor-last' : ''}`} aria-hidden="true" />
);

const Spinner = () => <span className="tl-spin" aria-hidden="true" />;

// Colors a printed line the way the CLI's parts read: questions and numbers in amber, details muted,
// links in blue.
const paint = (text: string): ReactNode => {
  const live = LIVE.exec(text);
  if (live) {
    return (
      <>
        <span className="tl-live text-success">{live[1]}</span>
        {links(live[2] ?? '')}
      </>
    );
  }
  if (text.startsWith('? ')) {
    return (
      <>
        <span className="text-signal">?</span>
        {text.slice(1)}
      </>
    );
  }
  const numbered = NUMBERED.exec(text);
  if (numbered) {
    return (
      <>
        {numbered[1]}
        <span className="text-signal">{numbered[2]}</span>
        <Muted>{links(numbered[3] ?? '')}</Muted>
      </>
    );
  }
  const command = COMMAND.exec(text);
  if (command) {
    return (
      <>
        {command[1]}
        {command[2]}
        <Muted>{links(command[3] ?? '')}</Muted>
      </>
    );
  }
  return text.startsWith(' ') ? <Muted>{links(text)}</Muted> : links(text);
};

const ask = (prompt: string): ReactNode =>
  prompt.startsWith('? ') ? (
    <>
      <span className="text-signal">?</span>
      {mark(prompt.slice(1), HINT, 'text-muted-foreground')}
    </>
  ) : (
    <Muted>{prompt}</Muted>
  );

const content = (line: Line): ReactNode => {
  switch (line.kind) {
    case 'command':
      return (
        <>
          <span className="text-signal">$</span> <span className="tl-typed">{line.typed}</span>
          <Cursor />
        </>
      );
    case 'ask':
      return (
        <>
          {ask(line.prompt)}{' '}
          {line.typed ? <span className="tl-typed text-signal">{line.typed}</span> : null}
          <Cursor />
        </>
      );
    case 'work':
      return (
        <>
          <Muted>{line.text}</Muted>
          <Spinner />
        </>
      );
    case 'step':
      return (
        <>
          <span className="tl-arrow">
            <span className="tl-glyph text-success">→</span>
            <Spinner />
          </span>
          <span className="tl-pending">{line.text.slice(1)}</span>
        </>
      );
    default:
      return paint(line.text);
  }
};

/**
 * A command's transcript, in color. While `playing` it runs as in a terminal: the command and the
 * answers are typed, work spins, each line prints on time and the shell prompts again at the end.
 * Otherwise, as when prerendered or with reduced motion, it shows that final frame.
 */
export const Terminal = ({ transcript, playing }: { transcript: string; playing: boolean }) => {
  const { lines, end } = playback(transcript);
  return (
    <pre className={`code ${playing ? 'tl-playing' : ''}`}>
      <code>
        {lines.map((line) => (
          <span key={line.at} className="tl-line" style={playing ? timing(line) : undefined}>
            {content(line)}
          </span>
        ))}
        <span className="tl-line" style={playing ? timing({ at: end }) : undefined}>
          <span className="text-signal">$</span> <Cursor last />
        </span>
      </code>
    </pre>
  );
};
