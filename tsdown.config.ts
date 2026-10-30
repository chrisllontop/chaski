import { defineConfig } from 'tsdown';

export default defineConfig({
  // Each entry runs in a runtime of its own, so none may pull another's code
  // into its bundle.
  entry: {
    index: 'src/index.ts',
    worker: 'src/worker/index.ts',
    client: 'src/client/index.ts',
    sw: 'src/sw/index.ts',
    react: 'src/react/index.ts',
    // The `chaskijs` command, for Node: it writes SQL and never touches a database.
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  // tsc emits the declarations (pnpm build:types): it infers the Drizzle and zod types.
  dts: false,
  deps: {
    // The Workers runtime and, for the command, Node's own modules come with the runtime.
    neverBundle: ['cloudflare:workers', /^node:/],
    // better-drizzle ships inside the bundle: its peer range pins drizzle-orm ^0.30, so npm would
    // install that older release next to ours and bundlers would pick it up. Its imports of
    // drizzle-orm stay external and reach the release Chaski depends on.
    onlyBundle: ['better-drizzle'],
  },
  // better-drizzle is Apache-2.0, which asks that its license travel with the code.
  copy: [
    {
      from: 'node_modules/better-drizzle/LICENSE',
      to: 'dist/licenses',
      rename: 'better-drizzle.txt',
    },
  ],
  clean: true,
});
