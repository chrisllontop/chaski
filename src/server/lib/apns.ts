import { signEs256Jwt } from './jwt';

export type ApnsEnvironment = 'sandbox' | 'production';

export type ApnsCredentials = {
  teamId: string;
  keyId: string;
  bundleId: string;
  environment: ApnsEnvironment;
  privateKeyPem: string;
};

export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: string;
  };
  [key: string]: unknown;
};

const importPrivateKey = async (pem: string): Promise<CryptoKey> => {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('the APNs private key is not valid base64 PEM');
  }
  return crypto.subtle
    .importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    .catch(() => {
      throw new Error('the APNs private key is not a PKCS#8 P-256 key');
    });
};

// Apple accepts a provider token for 60 minutes and rejects refreshes more
// often than every 20, so each isolate reuses its token for 45.
const TOKEN_TTL_MS = 45 * 60 * 1000;

const tokenCache = new Map<string, { token: string; issuedAt: number }>();

// The team is part of the key: the same key id under another team must not
// reuse a token signed for the first.
const cacheKey = (creds: Pick<ApnsCredentials, 'teamId' | 'keyId'>) =>
  `${creds.teamId}:${creds.keyId}`;

export const clearApnsAuthToken = (creds: Pick<ApnsCredentials, 'teamId' | 'keyId'>): void => {
  tokenCache.delete(cacheKey(creds));
};

export const getApnsAuthToken = async (
  creds: Pick<ApnsCredentials, 'teamId' | 'keyId' | 'privateKeyPem'>,
): Promise<string> => {
  const key = cacheKey(creds);
  const cached = tokenCache.get(key);
  if (cached && Date.now() - cached.issuedAt < TOKEN_TTL_MS) return cached.token;

  const issuedAt = Date.now();
  const token = await signEs256Jwt(
    { kid: creds.keyId },
    { iss: creds.teamId, iat: Math.floor(issuedAt / 1000) },
    await importPrivateKey(creds.privateKeyPem),
  );
  tokenCache.set(key, { token, issuedAt });
  return token;
};

const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
};

export const buildApnsRequest = (input: {
  authToken: string;
  deviceToken: string;
  bundleId: string;
  environment: ApnsEnvironment;
  payload: ApnsPayload;
  collapseId?: string;
}): { url: string; headers: Record<string, string>; body: string } => {
  const headers: Record<string, string> = {
    authorization: `bearer ${input.authToken}`,
    'apns-topic': input.bundleId,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
    'content-type': 'application/json',
  };
  if (input.collapseId) headers['apns-collapse-id'] = input.collapseId.slice(0, 64);
  return {
    url: `${APNS_HOSTS[input.environment]}/3/device/${input.deviceToken}`,
    headers,
    body: JSON.stringify(input.payload),
  };
};
