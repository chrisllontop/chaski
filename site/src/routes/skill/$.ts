import { createFileRoute } from '@tanstack/react-router';

const ROOT = '../../../../skills/chaski/';

// The agent skill, read from the repository at build time, so chaski.sh serves the same files
// `npx skills add` installs and their relative links resolve here too.
const files = import.meta.glob<string>('../../../../skills/chaski/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
};

// Prerendered at every file's path; vite.config.ts lists them.
export const Route = createFileRoute('/skill/$')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const path = params._splat ?? '';
        const body = files[`${ROOT}${path}`];
        const type = TYPES[path.slice(path.lastIndexOf('.') + 1)];
        if (body === undefined || !type) return new Response('Not found', { status: 404 });
        return new Response(body, { headers: { 'content-type': type } });
      },
    },
  },
});
