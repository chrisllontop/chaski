import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  // tsc emits the declarations (pnpm build:types): it infers the Drizzle and zod types.
  dts: false,
  external: ['cloudflare:workers'],
  clean: true,
});
