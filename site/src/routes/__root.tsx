import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import geistMono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { NotFound } from '~/components/not-found';
import styles from '~/styles.css?url';

const font = (href: string) =>
  ({ rel: 'preload', href, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' }) as const;

const RootDocument = () => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body className="min-h-dvh bg-background">
      <Outlet />
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#080808' },
      { name: 'color-scheme', content: 'dark' },
    ],
    links: [
      font(geist),
      font(geistMono),
      { rel: 'stylesheet', href: styles },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  component: RootDocument,
  notFoundComponent: NotFound,
});
