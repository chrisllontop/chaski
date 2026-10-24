export const encodeBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const encodeBase64UrlJson = (value: unknown): string =>
  encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));

/** Returns null for input that is not base64url, so callers report their own error. */
export const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> | null => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  try {
    return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return null;
  }
};
