import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { site } from '~/lib/site';
import { Logo } from '../logo';

const linkClass = 'w-max text-sm leading-5 transition-colors hover:text-signal';

const Column = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex w-[140px] flex-col gap-3">
    <p className="font-mono text-xs leading-4 text-muted-foreground">{title}</p>
    {children}
  </div>
);

export const SiteFooter = () => (
  <footer className="border-t border-border">
    <div className="wrap flex flex-col gap-12 pt-14 pb-12">
      <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3.5">
          <Logo className="h-7 w-max" />
          <p className="text-sm leading-5 text-muted-foreground">
            Notifications that run as a Worker of their own, next to your app.
          </p>
        </div>
        <nav className="flex gap-10 sm:gap-20" aria-label="Footer">
          <Column title="Product">
            <Link to="/docs/$" params={{ _splat: '' }} className={linkClass}>
              Docs
            </Link>
            <Link to="/docs/$" params={{ _splat: 'dashboard' }} className={linkClass}>
              Dashboard
            </Link>
            <Link to="/docs/$" params={{ _splat: 'browser-clients' }} className={linkClass}>
              Browser clients
            </Link>
            <Link to="/docs/$" params={{ _splat: 'agents' }} className={linkClass}>
              Agent skill
            </Link>
            <a href="/llms.txt" className={linkClass}>
              llms.txt
            </a>
          </Column>
          <Column title="Project">
            <a href={site.repo} className={linkClass}>
              GitHub
            </a>
            <a href={site.npm} className={linkClass}>
              npm
            </a>
            <a href={site.releases} className={linkClass}>
              Releases
            </a>
          </Column>
        </nav>
      </div>
      <div className="flex items-center justify-between gap-6">
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          MIT License · © 2026 Christian Llontop
        </p>
        <p className="font-mono text-xs leading-4 text-muted-foreground">chaski.sh</p>
      </div>
    </div>
  </footer>
);
