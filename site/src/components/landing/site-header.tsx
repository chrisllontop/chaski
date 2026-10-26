import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { site } from '~/lib/site';
import { BookIcon, GitHubIcon, PackageIcon } from '../icons';
import { Logo } from '../logo';

const linkClass =
  'flex items-center gap-2 rounded-md text-sm leading-5 text-muted-foreground transition-colors hover:text-foreground max-sm:p-1.5';

const NavLabel = ({ children }: { children: ReactNode }) => (
  <span className="max-sm:sr-only">{children}</span>
);

export const SiteHeader = () => (
  <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
    <div className="wrap flex h-[72px] items-center justify-between gap-4">
      <Link to="/" className="shrink-0 rounded-md">
        <Logo className="h-7 w-auto" />
      </Link>
      <nav aria-label="Main">
        <ul className="flex items-center gap-0.5 sm:gap-7">
          <li>
            <Link to="/docs/$" params={{ _splat: '' }} className={linkClass}>
              <BookIcon />
              <NavLabel>Docs</NavLabel>
            </Link>
          </li>
          <li>
            <a href={site.repo} className={linkClass}>
              <GitHubIcon />
              <NavLabel>GitHub</NavLabel>
            </a>
          </li>
          <li className="max-sm:hidden">
            <a href={site.npm} className={linkClass}>
              <PackageIcon />
              <NavLabel>npm</NavLabel>
            </a>
          </li>
          <li className="pl-2 sm:pl-0">
            <Link
              to="/docs/$"
              params={{ _splat: 'install' }}
              className="flex h-8 items-center rounded-md bg-primary px-3.5 text-sm leading-5 font-medium whitespace-nowrap text-primary-foreground transition-colors hover:bg-white"
            >
              Get started
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  </header>
);
