import { useNavigate } from '@tanstack/react-router';
import { useStaticSearch } from 'fumadocs-core/search/client';
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FileIcon, SearchIcon } from '../icons';

const SearchContext = createContext<{ open: () => void } | null>(null);

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) throw new Error('useSearch needs a <SearchProvider> above it');
  return context;
};

// Results quote the page's Markdown; the list shows it as plain text.
const plain = (text: string) =>
  text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '');

type Result = { id: string; url: string; type: 'page' | 'heading' | 'text'; content: string };

const Results = ({ onPick }: { onPick: (url: string) => void }) => {
  const { search, onSearchChange, isLoading, data, error } = useStaticSearch({
    from: '/search.json',
  });
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const results = useMemo(
    () => (data?.items ?? []).filter((item): item is Result & typeof item => item.type !== 'table'),
    [data],
  );

  useEffect(() => {
    document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  }, [listId, highlighted]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlighted((index) => (index + step + results.length) % Math.max(results.length, 1));
    }
    if (event.key === 'Enter') {
      const result = results[highlighted];
      if (result) onPick(result.url);
    }
  };

  const query = search.trim();
  return (
    <>
      <div className="flex h-[52px] items-center gap-3 border-b border-border px-4">
        <SearchIcon size={16} className="shrink-0 text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the user just opened this dialog to type in it
          autoFocus
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results[highlighted] ? `${listId}-${highlighted}` : undefined}
          aria-label="Search the docs"
          placeholder="Search the docs"
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 grow bg-transparent text-[15px] leading-5 outline-none placeholder:text-muted-foreground"
        />
        <kbd className="flex h-[22px] items-center rounded-[5px] border border-border px-1.5 font-mono text-[11px] leading-[14px] text-muted-foreground">
          Esc
        </kbd>
      </div>
      <div className="max-h-[min(60vh,480px)] overflow-y-auto p-2">
        {results.length > 0 ? (
          <div id={listId} role="listbox" aria-label="Results">
            {results.map((result, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the input above handles the keyboard for the list
              <div
                key={result.id}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === highlighted}
                onMouseMove={() => setHighlighted(index)}
                onClick={() => onPick(result.url)}
                className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 aria-selected:bg-accent ${result.type === 'page' ? '' : 'pl-9'}`}
              >
                {result.type === 'page' ? (
                  <FileIcon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                ) : null}
                <span
                  className={`line-clamp-2 text-sm leading-5 ${result.type === 'page' ? 'font-medium' : 'text-muted-foreground'}`}
                >
                  {result.type === 'heading' ? <span className="text-faint"># </span> : null}
                  {plain(result.content)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-sm leading-5 text-muted-foreground">
            {error
              ? 'We couldn’t load the search index. Please try again.'
              : !query
                ? 'Search guides and reference by title or content.'
                : isLoading
                  ? 'Searching…'
                  : `No results for “${query}”.`}
          </p>
        )}
      </div>
    </>
  );
};

export const SearchProvider = ({ children }: { children: ReactNode }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (isOpen && !element.open) element.showModal();
    if (!isOpen && element.open) element.close();
  }, [isOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const pick = (url: string) => {
    setIsOpen(false);
    void navigate({ href: url });
  };

  return (
    <SearchContext.Provider value={useMemo(() => ({ open }), [open])}>
      {children}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape already closes a modal dialog */}
      <dialog
        ref={dialog}
        aria-label="Search the docs"
        onClose={() => setIsOpen(false)}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog itself.
          if (event.target === event.currentTarget) setIsOpen(false);
        }}
        className="mx-auto mt-[12vh] w-[min(640px,calc(100%-32px))] overflow-hidden rounded-xl border border-foreground/12 bg-popover p-0 text-foreground shadow-[0_24px_48px_-12px_rgb(0_0_0/0.6)] backdrop:bg-black/60"
      >
        {isOpen ? <Results onPick={pick} /> : null}
      </dialog>
    </SearchContext.Provider>
  );
};
