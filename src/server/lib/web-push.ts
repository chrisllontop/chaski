import { decodeBase64Url } from './base64';
import { signEs256Jwt } from './jwt';

// Web push message encryption (RFC 8291) with the aes128gcm content coding
// (RFC 8188): the one coding every browser must accept, and the only one
// Safari does.

const encoder = new TextEncoder();

const RECORD_SIZE = 4096;
const HEADER_BYTES = 86;
const TAG_BYTES = 16;

/** Push services take 4096-byte bodies: the header, the tag and a delimiter byte leave this. */
export const MAX_PAYLOAD_BYTES: number = RECORD_SIZE - HEADER_BYTES - TAG_BYTES - 1;

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) => {
  const key = await crypto.subtle.importKey('raw', concat(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(salt), info: concat(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
};

/**
 * Encrypts a payload for one subscription. `salt` and `serverKeys` are fresh
 * for every message; they are parameters only so the RFC's test vector can
 * pin them.
 */
export const encryptPushPayload = async (
  payload: Uint8Array,
  keys: { p256dh: string; auth: string },
  pinned: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> => {
  const uaPublic = decodeBase64Url(keys.p256dh);
  const authSecret = decodeBase64Url(keys.auth);
  if (uaPublic?.length !== 65 || !authSecret?.length) {
    throw new Error('the subscription keys are malformed');
  }
  if (payload.length > MAX_PAYLOAD_BYTES) throw new Error('the push payload is too large');

  const serverKeys =
    pinned.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', serverKeys.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // The runtime reads the spec's `public` member; Workers types spell it
  // `$public`, an artifact of their generator.
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams, serverKeys.privateKey, 256),
  );

  const salt = pinned.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // One record: the payload, then 0x02, which marks it as the last record.
  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      cekKey,
      concat(payload, new Uint8Array([2])),
    ),
  );

  const header = new Uint8Array(HEADER_BYTES);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
};

const vapidKeys = new Map<string, Promise<CryptoKey>>();

const importVapidKey = (privateJwk: string) => {
  let key = vapidKeys.get(privateJwk);
  if (!key) {
    key = crypto.subtle.importKey(
      'jwk',
      JSON.parse(privateJwk) as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    vapidKeys.set(privateJwk, key);
  }
  return key;
};

// Push services refuse a VAPID token that lives longer than 24 hours.
const VAPID_TTL_SECONDS = 12 * 60 * 60;

/** The Authorization header that identifies the application server (RFC 8292). */
export const vapidAuthorization = async (
  endpoint: string,
  vapid: { subject: string; publicKey: string; privateJwk: string },
): Promise<string> => {
  const token = await signEs256Jwt(
    { typ: 'JWT' },
    {
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + VAPID_TTL_SECONDS,
      sub: vapid.subject,
    },
    await importVapidKey(vapid.privateJwk),
  );
  return `vapid t=${token}, k=${vapid.publicKey}`;
};
