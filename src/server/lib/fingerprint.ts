/**
 * Fingerprints a channel's default content. A translation keeps the fingerprint of the content it
 * was written from, and reads as outdated once the channel's no longer matches it.
 */
export const sourceHash = async (content: {
  subject?: string | null;
  body?: string | null;
  textBody?: string | null;
}): Promise<string> => {
  const fields = [content.subject ?? null, content.body ?? null, content.textBody ?? null];
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(fields)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** No content fingerprints to it, so a translation stored with it reads as outdated. */
export const OUTDATED_HASH = '';
