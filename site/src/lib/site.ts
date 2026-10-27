import { version } from '../../../package.json';

const repo = 'https://github.com/chrisllontop/chaski';

export const site = {
  url: 'https://chaski.sh',
  repo,
  npm: 'https://www.npmjs.com/package/chaskijs',
  releases: `${repo}/releases`,
  issues: `${repo}/issues`,
  version,
};

export const editUrl = (path: string) => `${repo}/blob/main/site/content/docs/${path}`;

export const skillUrl = `${site.url}/skill/SKILL.md`;

/** What every "copy the prompt" button copies, and what the landing shows pasted. */
export const setupPrompt = `Set up Chaski, notifications for Cloudflare Workers, in this project. Follow ${skillUrl} step by step, and ask me before anything that touches my Cloudflare account.`;
