import type { ShikiTransformer, ThemeRegistrationRaw } from 'shiki';

const FOREGROUND = '#f5f5f5';

// A quiet palette: keywords recede, strings carry the only warmth, comments sit lowest.
const TOKEN_CLASSES: Record<string, string> = {
  '#8a8a8a': 'tk-keyword',
  '#e6c7a0': 'tk-string',
  '#6b6b6b': 'tk-comment',
  '#f4a340': 'tk-signal',
};

export const codeTheme: ThemeRegistrationRaw = {
  name: 'chaski',
  type: 'dark',
  fg: FOREGROUND,
  bg: '#0e0e0e',
  settings: [
    { settings: { foreground: FOREGROUND, background: '#0e0e0e' } },
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#6b6b6b' },
    },
    {
      scope: [
        'string',
        'punctuation.definition.string',
        'constant.numeric',
        'constant.language',
        'constant.character',
      ],
      settings: { foreground: '#e6c7a0' },
    },
    {
      scope: [
        'keyword',
        'storage',
        'variable.language',
        'punctuation.definition.template-expression',
      ],
      settings: { foreground: '#8a8a8a' },
    },
    {
      // Shell arguments are plain words, not strings worth coloring.
      scope: ['string.unquoted.argument', 'string.unquoted.shell'],
      settings: { foreground: FOREGROUND },
    },
    {
      scope: ['meta.embedded.liquid', 'punctuation.output.liquid', 'variable.other.liquid'],
      settings: { foreground: '#f4a340' },
    },
  ],
};

const colorOf = (style: string) =>
  /(?:^|;)\s*(?:color|--shiki-dark)\s*:\s*(#[0-9a-f]{6})/i.exec(style)?.[1]?.toLowerCase();

/**
 * The site's Content-Security-Policy forbids inline styles, and Shiki colors every token with one.
 * This swaps each color for a class the stylesheet defines, and fails the build on a color the
 * theme above doesn't declare.
 */
export const transformerTokenClasses = (): ShikiTransformer => ({
  name: 'chaski:token-classes',
  pre(node) {
    delete node.properties.style;
    node.properties['data-language'] = this.options.lang;
  },
  span(node) {
    const style = node.properties.style;
    if (typeof style !== 'string') return;
    delete node.properties.style;
    const color = colorOf(style);
    if (!color || color === FOREGROUND) return;
    const className = TOKEN_CLASSES[color];
    if (!className) throw new Error(`code-theme: no class for the token color ${color}`);
    this.addClassToHast(node, className);
  },
});
