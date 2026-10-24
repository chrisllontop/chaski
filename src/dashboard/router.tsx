import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';

const Home = () => (
  <main className="grid min-h-dvh place-items-center">
    <h1 className="text-2xl font-semibold">Chaski</h1>
  </main>
);

const NotFound = () => (
  <main className="grid min-h-dvh place-content-center gap-3 text-center">
    <p>We couldn’t find this page.</p>
    <Link to="/" className="underline">
      Go to the dashboard
    </Link>
  </main>
);

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFound });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });

// The server writes the mount path into <base href>, so the router reads it from there.
const basepath = new URL(document.baseURI).pathname.replace(/\/$/, '') || '/';

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]), basepath });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
