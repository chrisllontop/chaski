import { decodeBase64Url, encodeBase64Url } from './base64';

// The secrets saved on the Channels page are sealed with AES-GCM-256 under a key HKDF-SHA256
// derives from CHASKI_SECRET. Each seal takes a random IV and the settings section as additional
// data, so a sealed value pasted into another section's row doesn't open.

/** Shorter than this, CHASKI_SECRET would be the weakest part of the encryption. */
export const MIN_SECRET_LENGTH = 32;

export type SecretStatus = 'set' | 'missing' | 'too_short';

export const secretStatus = (secret: string | undefined): SecretStatus => {
  const value = secret?.trim() ?? '';
  if (!value) return 'missing';
  return value.length < MIN_SECRET_LENGTH ? 'too_short' : 'set';
};

const VERSION = 'v1';
const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let derived: { secret: string; key: Promise<CryptoKey> } | undefined;

const keyFor = (secret: string): Promise<CryptoKey> => {
  if (derived?.secret !== secret) {
    const key = crypto.subtle
      .importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
      .then((material) =>
        crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(),
            info: encoder.encode('chaski settings v1'),
          },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    derived = { secret, key };
  }
  return derived.key;
};

/** `v1.<iv>.<ciphertext>`, both base64url; the version leaves room for another scheme. */
export const seal = async (secret: string, section: string, plaintext: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(section) },
    await keyFor(secret.trim()),
    encoder.encode(plaintext),
  );
  return `${VERSION}.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
};

// Every request loads the settings, so the last value each section opened to is kept: the
// same sealed value under the same secret opens to the same plaintext.
const opened = new Map<string, { secret: string; sealed: string; plaintext: string }>();

/** The plaintext, or null when the value doesn't open with this secret in this section. */
export const unseal = async (
  secret: string,
  section: string,
  sealed: string,
): Promise<string | null> => {
  const key = secret.trim();
  const memo = opened.get(section);
  if (memo?.secret === key && memo.sealed === sealed) return memo.plaintext;
  const [version, iv, ciphertext] = sealed.split('.');
  const ivBytes = decodeBase64Url(iv ?? '');
  const bytes = decodeBase64Url(ciphertext ?? '');
  if (version !== VERSION || ivBytes?.length !== IV_BYTES || !bytes) return null;
  try {
    const plaintext = decoder.decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes, additionalData: encoder.encode(section) },
        await keyFor(key),
        bytes,
      ),
    );
    opened.set(section, { secret: key, sealed, plaintext });
    return plaintext;
  } catch {
    // A wrong key, another section's value or a tampered one: GCM's tag check fails the same way.
    return null;
  }
};
