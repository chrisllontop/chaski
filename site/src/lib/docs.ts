import { source } from './source';

export type NavPage = { title: string; url: string };
export type NavGroup = { name: string; pages: NavPage[] };

const DOCS_ROOT = '/docs';

// The sidebar's groups come from the separators in content/docs/meta.json.
export const NAV: NavGroup[] = (() => {
  const groups: NavGroup[] = [];
  for (const node of source.getPageTree().children) {
    if (node.type === 'separator') groups.push({ name: String(node.name ?? ''), pages: [] });
    if (node.type === 'page')
      groups.at(-1)?.pages.push({ title: String(node.name), url: node.url });
  }
  return groups;
})();

const PAGES = NAV.flatMap((group) => group.pages);

export const groupOf = (url: string) =>
  NAV.find((group) => group.pages.some((page) => page.url === url));

export const neighbours = (url: string) => {
  const index = PAGES.findIndex((page) => page.url === url);
  return { previous: PAGES[index - 1], next: PAGES[index + 1] };
};

/** The router params for a docs URL, so links to pages stay typed. */
export const docParams = (url: string) => ({
  _splat: url === DOCS_ROOT ? '' : url.slice(DOCS_ROOT.length + 1),
});

/** Where a page's Markdown is prerendered, for "Copy as Markdown". */
export const markdownUrl = (url: string) =>
  url === DOCS_ROOT ? `${DOCS_ROOT}/index.md` : `${url}.md`;
