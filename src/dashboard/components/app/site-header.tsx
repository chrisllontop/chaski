import { Link, useMatches } from '@tanstack/react-router';
import { Fragment } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb';
import { Separator } from '~/components/ui/separator';
import { SidebarTrigger } from '~/components/ui/sidebar';
import { ModeToggle } from './mode-toggle';

type Crumb = { label: string; to?: string };

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The route's breadcrumb trail after "Chaski"; the last entry is the current page. */
    crumbs?: Crumb[];
  }
}

export const SiteHeader = ({ current }: { current?: string }) => {
  const matches = useMatches();
  const crumbs = matches.at(-1)?.staticData.crumbs ?? [];
  const trail: Crumb[] = [{ label: 'Chaski', to: '/' }, ...crumbs];
  if (current) trail.push({ label: current });

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {trail.map((crumb, index) => (
            <Fragment key={`${crumb.to ?? ''}:${crumb.label}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {index === trail.length - 1 || !crumb.to ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto">
        <ModeToggle />
      </div>
    </header>
  );
};
