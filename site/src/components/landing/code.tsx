import type { ReactNode } from 'react';

const KEYWORDS = new Set(['import', 'from', 'export', 'const', 'await', 'async', 'default']);

const TOKEN =
  /((?<!:)\/\/[^\n]*)|((?<!\w)'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b([a-z]+)\b/g;

/**
 * Colors the landing's TypeScript, JSONC and terminal samples with the classes the docs' Shiki theme
 * emits, without shipping Shiki. `://` is a URL, and a `'` after a letter an apostrophe.
 */
export const highlight = (code: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const [text, comment, string, word] = match;
    if (word && !KEYWORDS.has(word)) continue;
    if (match.index > last) nodes.push(code.slice(last, match.index));
    const className = comment ? 'tk-comment' : string ? 'tk-string' : 'tk-keyword';
    nodes.push(
      <span key={match.index} className={className}>
        {text}
      </span>,
    );
    last = match.index + text.length;
  }
  nodes.push(code.slice(last));
  return nodes;
};

export const Code = ({ children, className = '' }: { children: string; className?: string }) => (
  <pre className={`code ${className}`}>
    <code>{highlight(children)}</code>
  </pre>
);

export const Liquid = ({ children }: { children: ReactNode }) => (
  <span className="tk-signal">{children}</span>
);
