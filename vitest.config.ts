import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './test/fixture/wrangler.jsonc' },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(
                  path.join(import.meta.dirname, 'migrations'),
                ),
              },
            },
          })),
        ],
        test: {
          name: 'worker',
          include: ['test/**/*.test.ts'],
          exclude: ['test/browser/**', 'test/node/**'],
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        // The browser entries run in a page or a service worker, not in workerd.
        test: {
          name: 'browser',
          environment: 'happy-dom',
          environmentOptions: { happyDOM: { url: 'https://app.example.com/inbox' } },
          include: ['test/browser/**/*.test.ts'],
        },
      },
      {
        // The agent skill's scripts and the chaskijs command run in Node, against a project on disk.
        test: { name: 'node', environment: 'node', include: ['test/node/**/*.test.ts'] },
      },
    ],
  },
});
