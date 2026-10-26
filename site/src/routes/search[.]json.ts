import { createFileRoute } from '@tanstack/react-router';
import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '~/lib/source';

const search = createFromSource(source, { language: 'english' });

// Prerendered once: the search dialog downloads this index and searches it in the browser.
export const Route = createFileRoute('/search.json')({
  server: { handlers: { GET: () => search.staticGET() } },
});
