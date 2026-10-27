import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { defineConfig } from 'vite';

// The crawler finds every page through its links; these files have none pointing at them, or
// stay out of the sitemap.
const unlinked = [
  { path: '/404', sitemap: { exclude: true } },
  { path: '/search.json', sitemap: { exclude: true } },
  { path: '/llms.txt', sitemap: { exclude: true } },
  ...readdirSync('content/docs')
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => ({
      path: `/docs/${file.replace(/\.mdx$/, '.md')}`,
      sitemap: { exclude: true },
    })),
  // The agent skill, served from the repository's skills/chaski at /skill. A file type the route
  // has no content type for fails the build instead of going missing.
  ...readdirSync('../skills/chaski', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => ({
      path: `/skill/${relative('../skills/chaski', join(entry.parentPath, entry.name))}`,
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
