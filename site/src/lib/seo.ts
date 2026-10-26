import { site } from './site';

const OG_IMAGE = `${site.url}/og.png`;

/** The head tags every page shares; `path` is the page's canonical path. */
export const seo = ({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) => {
  const url = `${site.url}${path}`;
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: url },
      { property: 'og:site_name', content: 'Chaski' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Chaski: notifications that run inside your Worker.' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
};
