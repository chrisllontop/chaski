import { encodeBase64Url, encodeBase64UrlJson } from './base64';

/** Signs a JWT with ES256, the algorithm both APNs and VAPID require. */
export const signEs256Jwt = async (
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> => {
  const signingInput = `${encodeBase64UrlJson({ alg: 'ES256', ...header })}.${encodeBase64UrlJson(claims)}`;
  // WebCrypto already returns ECDSA signatures as the raw r||s pair JWS
  // ES256 expects, so there is no DER to unwrap.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
};
