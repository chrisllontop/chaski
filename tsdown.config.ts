import { defineConfig } from 'tsdown';

export default defineConfig({
  // Each entry runs in a runtime of its own, so none may pull another's code
  // into its bundle.
  entry: {
    index: 'src/index.ts',
    client: 'src/client/index.ts',
    sw: 'src/sw/index.ts',
    react: 'src/react/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  // tsc emits the declarations (pnpm build:types): it infers the Drizzle and zod types.
  dts: false,
  external: ['cloudflare:workers'],
  clean: true,
});
