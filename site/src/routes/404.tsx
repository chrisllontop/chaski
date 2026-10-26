import { createFileRoute } from '@tanstack/react-router';
import { NotFound } from '~/components/not-found';

// Prerendered to 404.html, which the static assets serve for any path that has no page.
export const Route = createFileRoute('/404')({
  head: () => ({
    meta: [{ title: 'Page not found · Chaski' }, { name: 'robots', content: 'noindex' }],
  }),
  component: NotFound,
});
