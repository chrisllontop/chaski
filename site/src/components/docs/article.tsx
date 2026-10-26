import { Link } from '@tanstack/react-router';
import { AnchorProvider, TOCItem, type TOCItemType } from 'fumadocs-core/toc';
import { type ReactNode, useRef } from 'react';
import { docParams, groupOf, markdownUrl, neighbours } from '~/lib/docs';
import { editUrl } from '~/lib/site';
import { CopyStatus, useCopy } from '../copy';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
} from '../icons';

// Safari only keeps the click's permission to write the clipboard if the write starts during the
// click, so the Markdown goes in as a promise instead of after the fetch.
const copyMarkdown = async (url: string) => {
  const text = () => fetch(url).then((response) => response.text());
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': text().then((value) => new Blob([value], { type: 'text/plain' })),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(await text());
};

const CopyMarkdownButton = ({ url, className = '' }: { url: string; className?: string }) => {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(() => copyMarkdown(markdownUrl(url)))}
      className={`flex w-max shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-[12.5px] leading-4 text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      {copied ? <CheckIcon size={13} className="text-success" /> : <CopyIcon size={13} />}
      Copy as Markdown
      <CopyStatus copied={copied} />
    </button>
  );
};

const Crumbs = ({ url, title }: { url: string; title: string }) => (
  <nav
    aria-label="Breadcrumb"
    className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]"
  >
    <span className="shrink-0 text-muted-foreground">{groupOf(url)?.name}</span>
    <ChevronRightIcon size={12} className="shrink-0 text-faint" />
    <span className="truncate" aria-current="page">
      {title}
    </span>
  </nav>
);

const TocLinks = ({ toc, onPick }: { toc: TOCItemType[]; onPick?: () => void }) => (
  <ul className="flex flex-col border-l border-border">
    {toc.map((item) => (
      <li key={item.url}>
        <TOCItem
          href={item.url}
          onClick={onPick}
          className={`relative flex min-h-7 items-center py-1 text-[13px] leading-[18px] text-muted-foreground transition-colors hover:text-foreground data-[active=true]:text-foreground data-[active=true]:before:absolute data-[active=true]:before:top-1 data-[active=true]:before:-left-px data-[active=true]:before:h-5 data-[active=true]:before:w-0.5 data-[active=true]:before:bg-signal ${item.depth > 2 ? 'pl-[26px]' : 'pl-3.5'}`}
        >
          {item.title}
        </TOCItem>
      </li>
    ))}
  </ul>
);

const Toc = ({ toc, path }: { toc: TOCItemType[]; path: string }) => (
  <aside className="sticky top-[112px] flex w-[200px] shrink-0 flex-col gap-3.5 self-start pt-1 max-xl:hidden">
    {toc.length > 0 ? (
      <>
        <p className="font-mono text-xs leading-4 text-muted-foreground">On this page</p>
        <TocLinks toc={toc} />
      </>
    ) : null}
    <div className="flex flex-col gap-2.5 border-t border-border pt-[18px]">
      <a
        href={editUrl(path)}
        className="flex w-max items-center gap-2 text-[13px] leading-[18px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <PencilIcon size={13} />
        Edit on GitHub
      </a>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0 })}
        className="flex w-max cursor-pointer items-center gap-2 text-[13px] leading-[18px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowUpIcon size={13} />
        Back to top
      </button>
    </div>
  </aside>
);

/** The bar narrow screens get instead of the sidebar and the table of contents. */
const MobileBar = ({ url, title, toc }: { url: string; title: string; toc: TOCItemType[] }) => {
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <div className="sticky top-14 z-30 flex h-11 items-center justify-between gap-4 border-b border-border bg-card px-5 lg:hidden">
      <Crumbs url={url} title={title} />
      {toc.length > 0 ? (
        <details ref={details} className="group shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground [&::-webkit-details-marker]:hidden">
            On this page
            <ChevronDownIcon size={12} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute inset-x-0 top-11 max-h-[60vh] overflow-y-auto border-b border-border bg-card px-5 py-4">
            <TocLinks
              toc={toc}
              onPick={() => {
                if (details.current) details.current.open = false;
              }}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
};

const Pager = ({ url }: { url: string }) => {
  const { previous, next } = neighbours(url);
  const card =
    'flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border border-border px-5 py-[18px] transition-colors hover:border-white/15 hover:bg-card';
  return (
    <nav aria-label="Pages" className="flex flex-col gap-4 pt-12 sm:flex-row">
      {previous ? (
        <Link to="/docs/$" params={docParams(previous.url)} className={card}>
          <span className="flex items-center gap-1 text-[13px] leading-[18px] text-muted-foreground">
            <ArrowLeftIcon size={13} />
            Previous
          </span>
          <span className="text-base leading-[22px] font-medium">{previous.title}</span>
        </Link>
      ) : (
        <span className="flex-1 max-sm:hidden" />
      )}
      {next ? (
        <Link to="/docs/$" params={docParams(next.url)} className={`${card} items-end text-right`}>
          <span className="flex items-center gap-1 text-[13px] leading-[18px] text-muted-foreground">
            Next
            <ArrowRightIcon size={13} />
          </span>
          <span className="text-base leading-[22px] font-medium">{next.title}</span>
        </Link>
      ) : (
        <span className="flex-1 max-sm:hidden" />
      )}
    </nav>
  );
};

const updated = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export const DocsArticle = ({
  url,
  path,
  title,
  description,
  toc,
  lastModified,
  children,
}: {
  url: string;
  path: string;
  title: string;
  description?: string;
  toc: TOCItemType[];
  lastModified?: Date;
  children: ReactNode;
}) => (
  <AnchorProvider toc={toc} single>
    <MobileBar url={url} title={title} toc={toc} />
    <div className="flex gap-20 px-5 pt-7 pb-12 lg:px-16 lg:pt-12 lg:pb-24">
      <main id="content" className="w-full max-w-[720px] min-w-0">
        <div className="flex items-center justify-between gap-4 pb-5 max-lg:hidden">
          <Crumbs url={url} title={title} />
          <CopyMarkdownButton url={url} className="h-7" />
        </div>
        <h1 className="text-[34px] leading-[38px] font-semibold tracking-[-0.035em] text-balance lg:text-[40px] lg:leading-[44px]">
          {title}
        </h1>
        {description ? (
          <p className="pt-3 text-[17px] leading-7 text-pretty text-muted-foreground lg:pt-3.5 lg:text-lg lg:leading-[30px]">
            {description}
          </p>
        ) : null}
        <CopyMarkdownButton url={url} className="mt-[18px] h-[30px] lg:hidden" />
        <div className="mt-9 mb-2 h-px bg-border max-lg:hidden" />
        <div className="docs-prose">{children}</div>
        <Pager url={url} />
        <div className="flex flex-wrap justify-between gap-4 pt-7 text-[13px] leading-[18px] text-faint">
          <p>{lastModified ? `Updated ${updated.format(lastModified)}` : null}</p>
          <p>MIT License · chaski.sh</p>
        </div>
      </main>
      <Toc toc={toc} path={path} />
    </div>
  </AnchorProvider>
);
