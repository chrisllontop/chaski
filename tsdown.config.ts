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
    // The `chaskijs` command, for Node: it writes and updates a Chaski project and runs Wrangler,
    // and never touches a database itself.
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  // tsc emits the declarations (pnpm build:types): it infers the Drizzle and zod types.
  dts: false,
  // The neutral platform reads no main field, and jsonc-parser ships its ESM build under `module`,
  // with no `exports`.
  inputOptions: { resolve: { mainFields: ['module'] } },
  deps: {
    // The Workers runtime and, for the command, Node's own modules come with the runtime.
    neverBundle: ['cloudflare:workers', /^node:/],
    // better-drizzle ships inside the bundle: its peer range pins drizzle-orm ^0.30, so npm would
    // install that older release next to ours and bundlers would pick it up. Its imports of
    // drizzle-orm stay external and reach the release Chaski depends on. jsonc-parser, which the
    // command edits wrangler.jsonc with, ships inside dist/cli.js, so apps don't install it.
    onlyBundle: ['better-drizzle', 'jsonc-parser'],
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
