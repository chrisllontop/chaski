import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from '../src/server/lib/base64';
import { encryptPushPayload, vapidAuthorization } from '../src/server/lib/web-push';

const bytes = (value: string) => decodeBase64Url(value) ?? new Uint8Array();

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const importServerKeys = async (): Promise<CryptoKeyPair> => {
  const point = bytes(RFC.asPublic);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: encodeBase64Url(point.slice(1, 33)),
    y: encodeBase64Url(point.slice(33, 65)),
  };
  const algorithm = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    publicKey: await crypto.subtle.importKey('jwk', jwk, algorithm, true, []),
    privateKey: await crypto.subtle.importKey(
      'jwk',
      { ...jwk, d: RFC.asPrivate },
      algorithm,
      false,
      ['deriveBits'],
    ),
  };
};

describe('encryptPushPayload', () => {
  it('reproduces the RFC 8291 example byte for byte', async () => {
    const body = await encryptPushPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: bytes(RFC.salt), serverKeys: await importServerKeys() },
    );

    expect(encodeBase64Url(body)).toBe(RFC.body);
  });

  it('refuses a payload that would not fit in a push body', async () => {
    await expect(
      encryptPushPayload(new Uint8Array(4000), { p256dh: RFC.uaPublic, auth: RFC.auth }),
    ).rejects.toThrowError('the push payload is too large');
  });

  it('refuses malformed subscription keys', async () => {
    await expect(
      encryptPushPayload(new Uint8Array(1), { p256dh: 'abc', auth: RFC.auth }),
    ).rejects.toThrowError('the subscription keys are malformed');
  });
});

describe('vapidAuthorization', () => {
  it('signs a token for the push service origin that the public key verifies', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const publicKey = encodeBase64Url(
      new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
    );
    const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));

    const header = await vapidAuthorization('https://push.example/sub/1?x=1', {
      subject: 'mailto:ops@host.test',
      publicKey,
      privateJwk,
    });

    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
    expect(key).toBe(publicKey);
    const [head, claims, signature] = (token ?? '').split('.');
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      bytes(signature ?? ''),
      new TextEncoder().encode(`${head}.${claims}`),
    );
    const decoded = JSON.parse(new TextDecoder().decode(bytes(claims ?? '')));
    expect(valid).toBe(true);
    expect(decoded).toMatchObject({ aud: 'https://push.example', sub: 'mailto:ops@host.test' });
    expect(decoded.exp - Date.now() / 1000).toBeLessThanOrEqual(24 * 60 * 60);
  });
});
