import { createFileRoute } from '@tanstack/react-router';
import { markdownUrl, NAV } from '~/lib/docs';
import { site, skillUrl } from '~/lib/site';
import { source } from '~/lib/source';

const descriptions = new Map(source.getPages().map((page) => [page.url, page.data.description]));

const entry = (title: string, url: string, notes?: string) =>
  `- [${title}](${url})${notes ? `: ${notes}` : ''}`;

// The llms.txt convention: a title, a summary, then lists of links. Every docs page links to its
// Markdown, in the sidebar's order and groups, so a new page shows up on its own.
const llms = [
  '# Chaski',
  '',
  '> Notification infrastructure for Cloudflare Workers, dashboard included. Chaski runs as a Worker of its own on your Cloudflare account, one per environment, and your app calls it over a service binding. It sends email, web push, iOS, macOS, Android and Windows push and in-app notifications, with templates, preferences, scheduling, retries and a dashboard. Open source under the MIT license, published on npm as `chaskijs`.',
  '',
  `To set Chaski up in a project, follow the agent skill at ${skillUrl}.`,
  ...NAV.flatMap((group) => [
    '',
    `## ${group.name}`,
    '',
    ...group.pages.map((page) =>
      entry(page.title, `${site.url}${markdownUrl(page.url)}`, descriptions.get(page.url)),
    ),
  ]),
  '',
  '## Agent skill',
  '',
  entry(
    'SKILL.md',
    skillUrl,
    'Sets up a Chaski Worker next to an app and connects the app and its frontend, audits the notifications a codebase sends and plans moving them onto Chaski, and fixes a setup that fails.',
  ),
  '',
].join('\n');

// Prerendered once, like the search index.
export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: () => new Response(llms, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
    },
  },
});
