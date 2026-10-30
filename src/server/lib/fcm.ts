import { signRs256Jwt } from './jwt';

export type FcmCredentials = {
  projectId: string;
  clientEmail: string;
  privateKeyId: string;
  privateKeyPem: string;
};

/** What went wrong: FCM's own code, Google's generic status and the field a 400 names. */
export type FcmError = { errorCode?: string; status?: string; field?: string };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

const importPrivateKey = async (pem: string): Promise<CryptoKey> => {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('the FCM service account private key is not valid base64 PEM');
  }
  return crypto.subtle
    .importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    .catch(() => {
      throw new Error('the FCM service account private key is not a PKCS#8 RSA key');
    });
};

// Renewed this long before Google's expiry, so a token never runs out in the
// middle of a fan-out.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// A service account can hold several keys; a token minted with one must not
// outlive a switch to another.
const cacheKey = (creds: Pick<FcmCredentials, 'clientEmail' | 'privateKeyId'>) =>
  `${creds.clientEmail}:${creds.privateKeyId}`;

export const clearFcmAccessToken = (
  creds: Pick<FcmCredentials, 'clientEmail' | 'privateKeyId'>,
): void => {
  tokenCache.delete(cacheKey(creds));
};

// Unlike an APNs provider token, the signed JWT is not the credential: Google
// trades it for an OAuth access token, and that is what each isolate reuses.
export const getFcmAccessToken = async (creds: FcmCredentials): Promise<string> => {
  const key = cacheKey(creds);
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const assertion = await signRs256Jwt(
    { kid: creds.privateKeyId, typ: 'JWT' },
    { iss: creds.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    await importPrivateKey(creds.privateKeyPem),
  );
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(
      `Google refused the FCM service account (${response.status}${body.error ? ` ${body.error}` : ''})`,
    );
  }
  tokenCache.set(key, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS,
  });
  return body.access_token;
};

export const buildFcmRequest = (input: {
  accessToken: string;
  projectId: string;
  deviceToken: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  tag?: string;
}): { url: string; headers: Record<string, string>; body: string } => {
  const message = {
    token: input.deviceToken,
    notification: input.notification,
    ...(Object.keys(input.data).length > 0 ? { data: input.data } : {}),
    android: {
      priority: 'HIGH',
      ttl: '3600s',
      // The tag replaces a repeat on screen. No collapse_key: FCM holds only
      // four collapse keys per offline device, so one per notification would
      // drop all but four of what waits for a phone to come back.
      ...(input.tag ? { notification: { tag: input.tag } } : {}),
    },
  };
  return {
    url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(input.projectId)}/messages:send`,
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message }),
  };
};

type GoogleErrorBody = {
  error?: {
    status?: string;
    details?: {
      '@type'?: string;
      errorCode?: string;
      fieldViolations?: { field?: string }[];
    }[];
  };
};

// FCM puts its own code in an FcmError detail and the field a 400 is about in
// a BadRequest detail; the top-level status is Google's generic one.
export const readFcmError = async (response: Response): Promise<FcmError> => {
  const body = (await response.json().catch(() => ({}))) as GoogleErrorBody;
  const details = body.error?.details ?? [];
  const fcm = details.find((d) => d['@type']?.endsWith('google.firebase.fcm.v1.FcmError'));
  const badRequest = details.find((d) => d['@type']?.endsWith('google.rpc.BadRequest'));
  return {
    errorCode: fcm?.errorCode,
    status: body.error?.status,
    field: badRequest?.fieldViolations?.[0]?.field,
  };
};
