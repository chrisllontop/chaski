import { createFileRoute, notFound } from '@tanstack/react-router';
import { Suspense, use } from 'react';
import { DocsArticle } from '~/components/docs/article';
import { DocsLayout } from '~/components/docs/layout';
import { mdxComponents } from '~/components/docs/mdx';
import { seo } from '~/lib/seo';
import { docs, source } from '~/lib/source';

const Content = ({ path, url }: { path: string; url: string }) => {
  const entry = docs.getPage(path);
  if (!entry) throw notFound();
  const { toc, lastModified } = use(entry.load());
  const Body = entry.body;
  return (
    <DocsArticle
      url={url}
      path={path}
      title={entry.title}
      description={entry.description}
      toc={toc}
      lastModified={lastModified}
    >
      <Body components={mdxComponents} />
    </DocsArticle>
  );
};

const Page = () => {
  const { path, url } = Route.useLoaderData();
  return (
    <DocsLayout current={url}>
      <Suspense>
        <Content path={path} url={url} />
      </Suspense>
    </DocsLayout>
  );
};

export const Route = createFileRoute('/docs/$')({
  // Runs in the browser too: the pages are bundled, so moving between them needs no server.
  loader: async ({ params }) => {
    const page = source.getPage(params._splat?.split('/').filter(Boolean) ?? []);
    if (!page) throw notFound();
    await docs.getPage(page.path)?.preload();
    return {
      path: page.path,
      url: page.url,
      title: page.data.title,
      description: page.data.description ?? '',
    };
  },
  head: ({ loaderData }) =>
    loaderData
      ? seo({
          title: `${loaderData.title} · Chaski docs`,
          description: loaderData.description,
          path: loaderData.url,
        })
      : {},
  component: Page,
});
