import { encodeBase64Url, encodeBase64UrlJson } from './base64';

const ALGORITHMS = {
  // WebCrypto already returns ECDSA signatures as the raw r||s pair JWS
  // ES256 expects, so there is no DER to unwrap.
  ES256: { name: 'ECDSA', hash: 'SHA-256' },
  RS256: { name: 'RSASSA-PKCS1-v1_5' },
} as const;

const signJwt = async (
  alg: keyof typeof ALGORITHMS,
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> => {
  const signingInput = `${encodeBase64UrlJson({ alg, ...header })}.${encodeBase64UrlJson(claims)}`;
  const signature = await crypto.subtle.sign(
    ALGORITHMS[alg],
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
};

/** Signs a JWT with ES256, the algorithm both APNs and VAPID require. */
export const signEs256Jwt = (
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> => signJwt('ES256', header, claims, privateKey);

/** Signs a JWT with RS256, the algorithm of Google service account keys. */
export const signRs256Jwt = (
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> => signJwt('RS256', header, claims, privateKey);
