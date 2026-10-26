import { remarkSteps } from 'fumadocs-core/mdx-plugins/remark-steps';
import { defineConfig } from 'fumadocs-mdx/config';
import { codeTheme, transformerTokenClasses } from './src/lib/code-theme';

export default defineConfig({
  mdxOptions: {
    // Steps run first, so the table of contents never sees their `[step]` marker.
    remarkPlugins: (plugins) => [remarkSteps, ...plugins],
    rehypeCodeOptions: {
      themes: { dark: codeTheme },
      defaultColor: 'dark',
      icon: false,
      transformers: [transformerTokenClasses()],
    },
  },
});
