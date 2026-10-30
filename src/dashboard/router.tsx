import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';
import { AppSidebar } from './components/app/app-sidebar';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { useAdminEvents } from './lib/events';
import type { Channel, DeliveryStatus } from './lib/types';
import type { DeliverySearch } from './routes/deliveries';

const STATUSES: DeliveryStatus[] = ['pending', 'held', 'sent', 'failed', 'dead', 'skipped'];
const CHANNELS: Channel[] = ['email', 'in_app', 'push'];

const Layout = () => {
  useAdminEvents();
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
};

const NotFound = () => (
  <main className="grid min-h-dvh place-content-center gap-3 text-center">
    <p>We couldn’t find this page.</p>
    <Link to="/" className="underline">
      Go to the dashboard
    </Link>
  </main>
);

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

// Each page loads on first visit, so the charts only load with the overview.
const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: lazyRouteComponent(() => import('./routes/overview'), 'OverviewPage'),
    staticData: { crumbs: [{ label: 'Overview' }] },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/deliveries',
    validateSearch: (search: Record<string, unknown>): DeliverySearch => ({
      status: STATUSES.find((status) => status === search.status),
      type: typeof search.type === 'string' && search.type ? search.type : undefined,
      channel: CHANNELS.find((channel) => channel === search.channel),
    }),
    component: lazyRouteComponent(() => import('./routes/deliveries'), 'DeliveriesPage'),
    staticData: { crumbs: [{ label: 'Deliveries' }] },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/templates',
    component: lazyRouteComponent(() => import('./routes/templates'), 'TemplatesPage'),
    staticData: { crumbs: [{ label: 'Templates' }] },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/templates/$templateId',
    // The language being edited, so a link can open a template in it.
    validateSearch: (search: Record<string, unknown>): { locale?: string } => ({
      locale: typeof search.locale === 'string' && search.locale ? search.locale : undefined,
    }),
    component: lazyRouteComponent(() => import('./routes/template-editor'), 'TemplateEditorPage'),
    staticData: { crumbs: [{ label: 'Templates', to: '/templates' }] },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/schedules',
    component: lazyRouteComponent(() => import('./routes/schedules'), 'SchedulesPage'),
    staticData: { crumbs: [{ label: 'Schedules' }] },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/channels',
    component: lazyRouteComponent(() => import('./routes/channels'), 'ChannelsPage'),
    staticData: { crumbs: [{ label: 'Channels' }] },
  }),
]);

// The server writes the mount path into <base href>, so the router reads it from there.
const basepath = new URL(document.baseURI).pathname.replace(/\/$/, '') || '/';

export const router = createRouter({ routeTree, basepath });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
