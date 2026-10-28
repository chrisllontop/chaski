// A named (&middot;), decimal (&#8217;) or hexadecimal (&#x2019;) character reference with its
// semicolon, so text such as "AT&T" or "Q&A" never counts.
const HTML_ENTITY = /&(?:[A-Za-z][A-Za-z0-9]{1,31}|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});/g;

/** The HTML entities in a text, each once: in a plain-text field they reach people as typed. */
export const htmlEntities = (text: string | null | undefined): string[] => [
  ...new Set(text?.match(HTML_ENTITY) ?? []),
];

/** Every template field is plain text except the email's HTML body. */
export const isPlainTextField = (channel: string, field: 'subject' | 'body' | 'textBody') =>
  !(channel === 'email' && field === 'body');
