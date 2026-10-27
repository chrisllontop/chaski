import { createFileRoute } from '@tanstack/react-router';
import { setupPrompt } from '~/lib/site';
import { source } from '~/lib/source';

const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line.trim()}`.trimEnd())
    .join('\n');

// The processed Markdown keeps MDX's own marks: heading anchors, step markers, callouts and the
// components the site fills in.
const toMarkdown = (processed: string) =>
  processed
    .replace(/(?: \[(?:#[\w-]+|step)\])+$/gm, '')
    .replace(/<SetupPrompt\s*\/>/g, () => `\`\`\`text\n${setupPrompt}\n\`\`\``)
    .replace(
      /<Callout title="([^"]*)">\s*([\s\S]*?)\s*<\/Callout>/g,
      (_, title: string, body: string) => quote(`**${title}**\n\n${body}`),
    );

// Prerendered next to each page, for "Copy as Markdown".
export const Route = createFileRoute('/docs/{$}.md')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = (params._splat ?? '').split('/').filter(Boolean);
        const page = source.getPage(slugs.join('/') === 'index' ? [] : slugs);
        if (!page) return new Response('Not found', { status: 404 });
        const body = toMarkdown(await page.data.getText('processed'));
        return new Response(`# ${page.data.title}\n\n${page.data.description ?? ''}\n\n${body}`, {
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        });
      },
    },
  },
});
