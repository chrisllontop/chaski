import { readdirSync } from 'node:fs';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { defineConfig } from 'vite';

// The crawler finds every page through its links; these files have none pointing at them.
const unlinked = [
  { path: '/404', sitemap: { exclude: true } },
  { path: '/search.json', sitemap: { exclude: true } },
  ...readdirSync('content/docs')
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => ({
      path: `/docs/${file.replace(/\.mdx$/, '.md')}`,
      sitemap: { exclude: true },
    })),
];

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    // wrangler.jsonc declares no Worker, so the deploy is static assets only. The prerender Worker
    // runs the server bundle in workerd at build time and never ships.
    cloudflare({
      experimental: {
        prerenderWorker: {
          viteEnvironment: { name: 'ssr' },
          config: (_, { entryWorkerConfig }) => ({
            name: 'chaski-site-prerender',
            compatibility_date: entryWorkerConfig.compatibility_date,
            compatibility_flags: ['nodejs_compat'],
            main: '@tanstack/react-start/server-entry',
          }),
        },
      },
    }),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: false,
        crawlLinks: true,
        failOnError: true,
        // A link to a section is the same page.
        filter: ({ path }) => !path.includes('#'),
      },
      pages: [{ path: '/' }, ...unlinked],
      sitemap: { enabled: true, host: 'https://chaski.sh' },
    }),
    react(),
  ],
  build: {
    // Inlined data: URLs would need a looser Content-Security-Policy than the site sends.
    assetsInlineLimit: 0,
  },
});
