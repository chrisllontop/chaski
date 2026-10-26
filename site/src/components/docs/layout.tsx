import { Link } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { docParams, NAV } from '~/lib/docs';
import { site } from '~/lib/site';
import { CloseIcon, GitHubIcon, MenuIcon, PackageIcon, SearchIcon } from '../icons';
import { Logo } from '../logo';
import { SearchProvider, useSearch } from './search';

const Brand = ({ compact = false }: { compact?: boolean }) => (
  <div className={`flex items-center ${compact ? 'gap-3' : 'gap-3.5'}`}>
    <Link to="/" className="rounded-md">
      <Logo className={compact ? 'h-[22px] w-auto' : 'h-[26px] w-auto'} />
    </Link>
    <span className={`w-px bg-foreground/18 ${compact ? 'h-4' : 'h-[18px]'}`} aria-hidden="true" />
    <Link
      to="/docs/$"
      params={{ _splat: '' }}
      className={`rounded-md font-medium ${compact ? 'text-sm leading-5' : 'text-[15px] leading-5'}`}
    >
      Docs
    </Link>
  </div>
);

const SearchButton = () => {
  const { open } = useSearch();
  return (
    <button
      type="button"
      onClick={open}
      className="flex h-9 w-[300px] shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card pr-2 pl-3 text-left transition-colors hover:border-white/15"
    >
      <SearchIcon size={15} className="text-muted-foreground" />
      <span className="grow text-sm leading-5 text-muted-foreground">Search the docs</span>
      <kbd className="flex h-[22px] items-center rounded-[5px] border border-border px-1.5 font-mono text-[11px] leading-[14px] text-muted-foreground">
        ⌘K
      </kbd>
    </button>
  );
};

const headerLink =
  'rounded-md text-sm leading-5 text-muted-foreground transition-colors hover:text-foreground';

const ProjectLinks = () => (
  <>
    <a
      href={site.repo}
      className="rounded-md text-muted-foreground transition-colors hover:text-foreground"
    >
      <GitHubIcon size={18} />
      <span className="sr-only">GitHub</span>
    </a>
    <a
      href={site.npm}
      className="rounded-md text-muted-foreground transition-colors hover:text-foreground"
    >
      <PackageIcon size={18} />
      <span className="sr-only">npm</span>
    </a>
  </>
);

/** The docs' groups and pages; `onNavigate` lets the mobile menu close itself. */
export const DocsNav = ({ current, onNavigate }: { current: string; onNavigate?: () => void }) => (
  <nav aria-label="Docs" className="flex flex-col gap-7">
    {NAV.map((group) => (
      <div key={group.name} className="flex flex-col gap-0.5">
        <p className="px-3 pb-2 font-mono text-xs leading-4 text-muted-foreground">{group.name}</p>
        {group.pages.map((page) => {
          const active = page.url === current;
          return (
            <Link
              key={page.url}
              to="/docs/$"
              params={docParams(page.url)}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-8 shrink-0 items-center rounded-md px-3 text-sm leading-5 transition-colors ${active ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {active ? (
                <span
                  className="absolute top-2 left-0 h-4 w-0.5 rounded-[2px] bg-signal"
                  aria-hidden="true"
                />
              ) : null}
              {page.title}
            </Link>
          );
        })}
      </div>
    ))}
  </nav>
);

const MobileMenu = ({
  id,
  current,
  onClose,
}: {
  id: string;
  current: string;
  onClose: () => void;
}) => {
  const { open } = useSearch();
  useEffect(() => {
    document.documentElement.classList.add('overflow-hidden');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.classList.toggle('overflow-hidden', false);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      id={id}
      className="fixed inset-x-0 top-14 bottom-0 z-40 flex flex-col gap-5 overflow-y-auto bg-background px-5 pt-5 pb-6 lg:hidden"
    >
      <button
        type="button"
        onClick={() => {
          onClose();
          open();
        }}
        className="flex h-10 shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-left"
      >
        <SearchIcon size={15} className="text-muted-foreground" />
        <span className="text-[15px] leading-5 text-muted-foreground">Search the docs</span>
      </button>
      <DocsNav current={current} onNavigate={onClose} />
      <div className="flex flex-wrap items-center gap-5 border-t border-border px-3 pt-[18px]">
        <Link to="/" className={headerLink}>
          Home
        </Link>
        <a href={site.releases} className={headerLink}>
          Changelog
        </a>
        <a href={site.repo} className={headerLink}>
          GitHub
        </a>
        <a href={site.npm} className={headerLink}>
          npm
        </a>
      </div>
    </div>
  );
};

const DocsHeader = ({ current }: { current: string }) => {
  const { open } = useSearch();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="flex h-14 items-center justify-between pr-4 pl-5 lg:h-16 lg:px-8">
        <div className="flex items-center gap-10">
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <div className="max-lg:hidden">
            <Brand />
          </div>
          <div className="max-lg:hidden">
            <SearchButton />
          </div>
        </div>
        <div className="flex items-center gap-6 max-lg:hidden">
          <Link to="/" className={headerLink}>
            Home
          </Link>
          <a href={site.releases} className={headerLink}>
            Changelog
          </a>
          <span className="flex h-6 items-center rounded-full border border-border px-2 font-mono text-xs leading-4 text-muted-foreground">
            v{site.version}
          </span>
          <ProjectLinks />
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <button
            type="button"
            onClick={open}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-primary"
          >
            <SearchIcon size={18} strokeWidth={1.75} />
            <span className="sr-only">Search the docs</span>
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            className={`flex size-9 cursor-pointer items-center justify-center rounded-lg text-primary ${menuOpen ? 'bg-accent' : ''}`}
          >
            {menuOpen ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
            <span className="sr-only">{menuOpen ? 'Close the menu' : 'Open the menu'}</span>
          </button>
        </div>
      </div>
      {menuOpen ? <MobileMenu id={menuId} current={current} onClose={closeMenu} /> : null}
    </header>
  );
};

export const DocsLayout = ({ current, children }: { current: string; children: ReactNode }) => (
  <SearchProvider>
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
    >
      Skip to content
    </a>
    <DocsHeader current={current} />
    <div className="lg:flex">
      <aside className="sticky top-16 h-[calc(100dvh-4rem)] w-[272px] shrink-0 overflow-y-auto border-r border-border px-5 py-8 max-lg:hidden">
        <DocsNav current={current} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  </SearchProvider>
);
