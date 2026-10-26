import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './test/fixture/wrangler.jsonc' } })],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
