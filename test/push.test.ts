import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushConfig } from '../src';
import { validateConfig } from '../src/server/config';
import { getClient } from '../src/server/db';
import { decodeBase64Url, encodeBase64Url } from '../src/server/lib/base64';
import { NotificationService } from '../src/server/services/notification.service';
import { chaski, fixtureConfig } from './fixture/worker';
import { processDeliveries, recipient, seedTemplate, useConfig } from './helpers';

const generateP256 = async () =>
  (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

const rawPublicKey = async (pair: CryptoKeyPair) =>
  encodeBase64Url(
    new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
  );

const vapidPair = await generateP256();
const vapid = {
  subject: 'mailto:ops@host.test',
  publicKey: await rawPublicKey(vapidPair),
  privateKey: ((await crypto.subtle.exportKey('jwk', vapidPair.privateKey)) as JsonWebKey).d ?? '',
};

const apnsPair = await generateP256();
const pkcs8 = new Uint8Array(
  (await crypto.subtle.exportKey('pkcs8', apnsPair.privateKey)) as ArrayBuffer,
);
const apns = {
  teamId: 'TEAM123456',
  keyId: 'KEY1234567',
  bundleId: 'com.host.app',
  environment: 'sandbox' as const,
  privateKey: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`,
};

const fcmPair = (await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const fcmPkcs8 = new Uint8Array(
  (await crypto.subtle.exportKey('pkcs8', fcmPair.privateKey)) as ArrayBuffer,
);

// The JSON key file the Firebase console downloads. Each test gets its own key
// id, so an access token cached by one test never answers for the next.
const serviceAccount = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'host-app',
    private_key_id: crypto.randomUUID(),
    private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...fcmPkcs8))}\n-----END PRIVATE KEY-----\n`,
    client_email: 'chaski@host-app.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token',
    ...fields,
  });

// What a browser's pushManager.subscribe() hands back: its own ECDH key and an
// auth secret. The browser keeps both to decrypt what arrives.
const browsers = new Map<string, { pair: CryptoKeyPair; auth: Uint8Array }>();

const browserSubscription = async (endpoint: string) => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  browsers.set(endpoint, { pair, auth });
  return { endpoint, keys: { p256dh: await rawPublicKey(pair), auth: encodeBase64Url(auth) } };
};

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  );
};

// Decrypts an aes128gcm body the way the browser does (RFC 8291).
const decryptAsBrowser = async (endpoint: string, body: Uint8Array) => {
  const browser = browsers.get(endpoint);
  if (!browser) throw new Error(`no browser subscribed ${endpoint}`);
  const salt = body.slice(0, 16);
  const keyLength = body[20] ?? 0;
  const asPublic = body.slice(21, 21 + keyLength);
  const uaPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', browser.pair.publicKey)) as ArrayBuffer,
  );
  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      browser.pair.privateKey,
      256,
    ),
  );
  const text = new TextEncoder();
  const info = new Uint8Array([...text.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(browser.auth, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, text.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + keyLength)),
  );
  // Drop the 0x02 delimiter that ends the last record.
  return JSON.parse(new TextDecoder().decode(plaintext.slice(0, plaintext.lastIndexOf(2))));
};

const IOS_TOKEN = 'A1B2C3D4'.repeat(8);
// FCM tokens are case-sensitive, so this one mixes cases on purpose.
const ANDROID_TOKEN = `dQw4w9WgXcQ:APA91bH${'Kx7_Lm-Pq2Rs'.repeat(12)}`;

type Call = { url: string; headers: Headers; body: Uint8Array };

const stubFetch = (
  respond: (url: string) => Response = () => new Response(null, { status: 201 }),
) => {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body;
    calls.push({
      url,
      headers: new Headers(init?.headers),
      body: body instanceof Uint8Array ? body : new TextEncoder().encode(String(body ?? '')),
    });
    return respond(url);
  });
  return calls;
};

const usePush = (push: PushConfig, overrides = {}) => {
  const config = fixtureConfig(env);
  useConfig({ channels: { ...config.channels, push }, ...overrides });
};

const sendPush = async () => {
  const result = await NotificationService.send({
    type: 'payment_received',
    recipient: recipient(),
    payload: { amount: 1500 },
    channels: ['push'],
  });
  await processDeliveries(result.notificationId);
  return getClient().deliveries.findFirst({
    where: { notificationId: result.notificationId, channel: 'push' },
  });
};

const devices = () => getClient().deviceTokens.findMany({ where: {} });

beforeEach(async () => {
  await seedTemplate('payment_received', 'push');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('web push', () => {
  beforeEach(() => usePush({ vapid }));

  it('sends an encrypted, VAPID-signed push to each registered browser', async () => {
    await chaski.push.register({
      recipient: recipient(),
      subscription: await browserSubscription('https://push.example/sub/1'),
    });
    const calls = stubFetch();

    const delivery = await sendPush();

    expect(delivery).toMatchObject({ status: 'sent', providerMessageId: 'push:1/1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://push.example/sub/1');
    expect(calls[0]?.headers.get('authorization')).toMatch(/^vapid t=.+, k=/);
    expect(calls[0]?.headers.get('content-encoding')).toBe('aes128gcm');
    expect(calls[0]?.headers.get('ttl')).toBe('3600');
    expect(calls[0]?.headers.get('urgency')).toBe('high');
    expect(
      await decryptAsBrowser('https://push.example/sub/1', calls[0]?.body ?? new Uint8Array()),
    ).toEqual({
      title: 'Hello Ana',
      body: 'Amount: 1500',
      href: '/payments/1500',
      tag: delivery?.notificationId,
    });
  });

  it('fails a push too large for web push instead of retrying it', async () => {
    await getClient().templateChannels.update({
      where: { id: 'tc_payment_received_push' },
      data: { body: 'x'.repeat(5000) },
    });
    await chaski.push.register({
      recipient: recipient(),
      subscription: await browserSubscription('https://push.example/sub/1'),
    });
    const calls = stubFetch();

    const delivery = await sendPush();

    expect(delivery).toMatchObject({ status: 'failed', errorCode: 'payload_too_large' });
    expect(calls).toEqual([]);
  });

  it('forgets a browser the push service reports gone', async () => {
    await chaski.push.register({
      recipient: recipient(),
      subscription: await browserSubscription('https://push.example/sub/gone'),
    });
    stubFetch(() => new Response(null, { status: 410 }));

    const delivery = await sendPush();

    expect(delivery).toMatchObject({
      status: 'failed',
      errorCode: 'no_device_tokens',
      attempts: 1,
    });
    expect(await devices()).toEqual([]);
  });

  it('retries when the push service fails', async () => {
    await chaski.push.register({
      recipient: recipient(),
      subscription: await browserSubscription('https://push.example/sub/1'),
    });
    stubFetch(() => new Response(null, { status: 503 }));

    const delivery = await sendPush();

    expect(delivery).toMatchObject({ status: 'pending', errorCode: 'provider_error', attempts: 1 });
  });

  it('skips a recipient whose only device has no credentials configured', async () => {
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });

    const result = await NotificationService.send({
      type: 'payment_received',
      recipient: recipient(),
      channels: ['push'],
    });

    expect(result.deliveries).toEqual([
      expect.objectContaining({ channel: 'push', status: 'skipped', reason: 'no_device_tokens' }),
    ]);
  });
});

describe('APNs', () => {
  beforeEach(() => usePush({ apns }));

  const verifyToken = async (authorization: string | null) => {
    const [header, claims, signature] = (authorization ?? '').replace('bearer ', '').split('.');
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      apnsPair.publicKey,
      decodeBase64Url(signature ?? '') ?? new Uint8Array(),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    const decode = (part = '') =>
      JSON.parse(new TextDecoder().decode(decodeBase64Url(part) ?? undefined));
    return { valid, header: decode(header), claims: decode(claims) };
  };

  it('sends to the device with a provider token it reuses', async () => {
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });
    const calls = stubFetch(() => new Response(null, { status: 200 }));

    await sendPush();
    await sendPush();

    expect(calls.map((call) => call.url)).toEqual([
      `https://api.sandbox.push.apple.com/3/device/${IOS_TOKEN.toLowerCase()}`,
      `https://api.sandbox.push.apple.com/3/device/${IOS_TOKEN.toLowerCase()}`,
    ]);
    expect(calls[0]?.headers.get('apns-topic')).toBe('com.host.app');
    expect(calls[1]?.headers.get('authorization')).toBe(calls[0]?.headers.get('authorization'));
    const token = await verifyToken(calls[0]?.headers.get('authorization') ?? null);
    expect(token).toMatchObject({
      valid: true,
      header: { alg: 'ES256', kid: 'KEY1234567' },
      claims: { iss: 'TEAM123456' },
    });
  });

  it('sends the alert Apple expects, with the link and a collapse id', async () => {
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });
    const calls = stubFetch(() => new Response(null, { status: 200 }));

    const delivery = await sendPush();

    const call = calls[0];
    expect(Object.fromEntries(call?.headers ?? [])).toMatchObject({
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-collapse-id': delivery?.notificationId,
      'content-type': 'application/json',
    });
    expect(JSON.parse(new TextDecoder().decode(call?.body))).toEqual({
      aps: { alert: { title: 'Hello Ana', body: 'Amount: 1500' }, sound: 'default' },
      href: '/payments/1500',
      tag: delivery?.notificationId,
    });
    const { claims } = await verifyToken(call?.headers.get('authorization') ?? null);
    expect(Math.abs(claims.iat - Date.now() / 1000)).toBeLessThan(60);
  });

  it('forgets a device Apple reports unregistered', async () => {
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });
    stubFetch(() => Response.json({ reason: 'Unregistered' }, { status: 410 }));

    expect(await sendPush()).toMatchObject({ status: 'failed', errorCode: 'no_device_tokens' });
    expect(await devices()).toEqual([]);
  });

  it('signs a new provider token after Apple rejects the cached one', async () => {
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });
    let rejected = false;
    const calls = stubFetch(() => {
      if (rejected) return new Response(null, { status: 200 });
      rejected = true;
      return Response.json({ reason: 'ExpiredProviderToken' }, { status: 403 });
    });

    expect(await sendPush()).toMatchObject({ status: 'pending', errorCode: 'provider_error' });
    expect(await sendPush()).toMatchObject({ status: 'sent' });
    expect(calls[1]?.headers.get('authorization')).not.toBe(calls[0]?.headers.get('authorization'));
  });

  it('forgets a device Apple reports as a bad token', async () => {
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });
    stubFetch(() => Response.json({ reason: 'BadDeviceToken' }, { status: 400 }));

    expect(await sendPush()).toMatchObject({ status: 'failed', errorCode: 'no_device_tokens' });
    expect(await devices()).toEqual([]);
  });
});

describe('FCM', () => {
  beforeEach(() => usePush({ fcm: { serviceAccount: serviceAccount() } }));

  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  const SEND_URL = 'https://fcm.googleapis.com/v1/projects/host-app/messages:send';

  // Google hands out a new access token on every exchange.
  const stubFcm = (
    respond: () => Response = () => Response.json({ name: 'projects/host-app/messages/1' }),
  ) => {
    let issued = 0;
    return stubFetch((url) =>
      url === TOKEN_URL
        ? Response.json({ access_token: `ya29.${++issued}`, expires_in: 3599 })
        : respond(),
    );
  };

  const fcmError = (status: number, errorCode: string, field?: string) =>
    Response.json(
      {
        error: {
          code: status,
          details: [
            { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode },
            ...(field
              ? [
                  {
                    '@type': 'type.googleapis.com/google.rpc.BadRequest',
                    fieldViolations: [{ field }],
                  },
                ]
              : []),
          ],
        },
      },
      { status },
    );

  const registerAndroid = () =>
    chaski.push.register({
      recipient: recipient(),
      platform: 'android',
      deviceToken: ANDROID_TOKEN,
    });

  const verifyAssertion = async (assertion: string | null) => {
    const [header, claims, signature] = (assertion ?? '').split('.');
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      fcmPair.publicKey,
      decodeBase64Url(signature ?? '') ?? new Uint8Array(),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    const decode = (part = '') =>
      JSON.parse(new TextDecoder().decode(decodeBase64Url(part) ?? undefined));
    return { valid, header: decode(header), claims: decode(claims) };
  };

  it('trades a signed service account assertion for an access token it reuses', async () => {
    await registerAndroid();
    const calls = stubFcm();

    await sendPush();
    await sendPush();

    expect(calls.map((call) => call.url)).toEqual([TOKEN_URL, SEND_URL, SEND_URL]);
    const form = new URLSearchParams(new TextDecoder().decode(calls[0]?.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(await verifyAssertion(form.get('assertion'))).toMatchObject({
      valid: true,
      header: { alg: 'RS256' },
      claims: {
        iss: 'chaski@host-app.iam.gserviceaccount.com',
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: TOKEN_URL,
      },
    });
    expect(calls[1]?.headers.get('authorization')).toBe('Bearer ya29.1');
    expect(calls[2]?.headers.get('authorization')).toBe('Bearer ya29.1');
  });

  it('sends the notification FCM expects, with the link and a tag', async () => {
    await registerAndroid();
    const calls = stubFcm();

    const delivery = await sendPush();

    expect(delivery).toMatchObject({ status: 'sent', providerMessageId: 'push:1/1' });
    expect(JSON.parse(new TextDecoder().decode(calls[1]?.body))).toEqual({
      message: {
        token: ANDROID_TOKEN,
        notification: { title: 'Hello Ana', body: 'Amount: 1500' },
        data: { href: '/payments/1500', tag: delivery?.notificationId },
        android: {
          priority: 'HIGH',
          ttl: '3600s',
          notification: { tag: delivery?.notificationId },
        },
      },
    });
  });

  it('forgets a device FCM reports unregistered', async () => {
    await registerAndroid();
    stubFcm(() => fcmError(404, 'UNREGISTERED'));

    expect(await sendPush()).toMatchObject({ status: 'failed', errorCode: 'no_device_tokens' });
    expect(await devices()).toEqual([]);
  });

  // The service account of another Firebase project is a config mistake, and
  // the devices must outlive it.
  it('keeps the device when the service account is of another Firebase project', async () => {
    await registerAndroid();
    stubFcm(() => fcmError(403, 'SENDER_ID_MISMATCH'));

    const delivery = await sendPush();

    expect(delivery).toMatchObject({ status: 'pending', errorCode: 'provider_error' });
    expect(delivery?.lastError).toContain('SENDER_ID_MISMATCH');
    expect(await devices()).toHaveLength(1);
  });

  it('forgets a device FCM calls an invalid token', async () => {
    await registerAndroid();
    stubFcm(() => fcmError(400, 'INVALID_ARGUMENT', 'message.token'));

    expect(await sendPush()).toMatchObject({ status: 'failed', errorCode: 'no_device_tokens' });
    expect(await devices()).toEqual([]);
  });

  it('keeps the device when FCM rejects another field of the message', async () => {
    await registerAndroid();
    stubFcm(() => fcmError(400, 'INVALID_ARGUMENT', 'message.android.ttl'));

    expect(await sendPush()).toMatchObject({ status: 'pending', errorCode: 'provider_error' });
    expect(await devices()).toHaveLength(1);
  });

  it('keeps the device when the service account may not send', async () => {
    await registerAndroid();
    stubFcm(() =>
      Response.json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, { status: 403 }),
    );

    const delivery = await sendPush();

    expect(delivery).toMatchObject({ status: 'pending', errorCode: 'provider_error' });
    expect(delivery?.lastError).toContain('PERMISSION_DENIED');
    expect(await devices()).toHaveLength(1);
  });

  it('retries, keeping the device, when FCM is unavailable', async () => {
    await registerAndroid();
    stubFcm(() => fcmError(503, 'UNAVAILABLE'));

    expect(await sendPush()).toMatchObject({ status: 'pending', errorCode: 'provider_error' });
    expect(await devices()).toHaveLength(1);
  });

  it('trades for a new access token after FCM rejects the cached one', async () => {
    await registerAndroid();
    let rejected = false;
    const calls = stubFcm(() => {
      if (rejected) return Response.json({ name: 'projects/host-app/messages/1' });
      rejected = true;
      return Response.json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, { status: 401 });
    });

    expect(await sendPush()).toMatchObject({ status: 'pending', errorCode: 'provider_error' });
    expect(await sendPush()).toMatchObject({ status: 'sent' });
    expect(calls.map((call) => call.url)).toEqual([TOKEN_URL, SEND_URL, TOKEN_URL, SEND_URL]);
    expect(calls[3]?.headers.get('authorization')).toBe('Bearer ya29.2');
  });

  it('still reaches the other devices when Google refuses the service account', async () => {
    usePush({ apns, fcm: { serviceAccount: serviceAccount() } });
    await registerAndroid();
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });
    stubFetch((url) =>
      url === TOKEN_URL
        ? Response.json({ error: 'invalid_grant' }, { status: 400 })
        : new Response(null, { status: 200 }),
    );

    expect(await sendPush()).toMatchObject({ status: 'sent', providerMessageId: 'push:1/2' });
    expect(await devices()).toHaveLength(2);
  });
});

describe('push subscriptions', () => {
  beforeEach(() => usePush({ vapid }));

  it('hands a known endpoint to the recipient who registers it last', async () => {
    const subscription = await browserSubscription('https://push.example/sub/shared');
    await chaski.push.register({ recipient: recipient('user_1'), subscription });

    await chaski.push.register({ recipient: recipient('user_2'), subscription });

    expect(await devices()).toEqual([
      expect.objectContaining({ recipientId: 'user_2', token: subscription.endpoint }),
    ]);
  });

  it('unregisters by endpoint, device token or recipient', async () => {
    await chaski.push.register({
      recipient: recipient(),
      subscription: await browserSubscription('https://push.example/sub/1'),
    });
    await chaski.push.register({ recipient: recipient(), platform: 'ios', deviceToken: IOS_TOKEN });

    expect(await chaski.push.unregister({ endpoint: 'https://push.example/sub/1' })).toEqual({
      unregistered: 1,
    });
    expect(await chaski.push.unregister({ deviceToken: IOS_TOKEN })).toEqual({ unregistered: 1 });
    expect(await chaski.push.unregister({ recipientId: 'user_1' })).toEqual({ unregistered: 0 });
    await expect(chaski.push.unregister({})).rejects.toMatchObject({ code: 'validation' });
  });

  it('keeps an FCM token as registered and unregisters it as sent', async () => {
    await chaski.push.register({
      recipient: recipient(),
      platform: 'android',
      deviceToken: ANDROID_TOKEN,
    });

    expect(await devices()).toEqual([
      expect.objectContaining({ platform: 'android', token: ANDROID_TOKEN }),
    ]);
    expect(await chaski.push.unregister({ deviceToken: ANDROID_TOKEN })).toEqual({
      unregistered: 1,
    });
    await expect(chaski.push.unregister({ deviceToken: 'not a token' })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('deviceToken must be an APNs device token or an FCM'),
    });
  });

  it('reports the VAPID public key, or null without one', async () => {
    expect(await chaski.push.vapidPublicKey()).toEqual({ publicKey: vapid.publicKey });

    useConfig();
    expect(await chaski.push.vapidPublicKey()).toEqual({ publicKey: null });
  });
});

describe('push config', () => {
  const withPush = (push: PushConfig) => {
    const config = fixtureConfig(env);
    return () => validateConfig({ ...config, channels: { ...config.channels, push } });
  };

  it('needs VAPID, APNs, FCM or several of them', () => {
    expect(withPush({})).toThrowError(/channels.push needs vapid/);
  });

  it('rejects a VAPID public key that is not an uncompressed P-256 point', () => {
    expect(withPush({ vapid: { ...vapid, publicKey: 'abc' } })).toThrowError(
      /vapid.publicKey must be a base64url uncompressed P-256 key/,
    );
  });

  it('accepts the private key as a JWK', () => {
    const jwk = JSON.stringify({ kty: 'EC', crv: 'P-256', d: vapid.privateKey });
    expect(withPush({ vapid: { ...vapid, privateKey: jwk } })().channels.push?.vapid).toEqual(
      expect.objectContaining({ privateJwk: jwk }),
    );
  });

  it('names the missing APNs field', () => {
    expect(withPush({ apns: { ...apns, teamId: '' } })).toThrowError(
      'Chaski config: channels.push.apns.teamId is required',
    );
  });

  it('reads the FCM credentials from the service account JSON', () => {
    const account = serviceAccount();
    expect(withPush({ fcm: { serviceAccount: account } })().channels.push?.fcm).toEqual({
      projectId: 'host-app',
      clientEmail: 'chaski@host-app.iam.gserviceaccount.com',
      privateKeyId: JSON.parse(account).private_key_id,
      privateKeyPem: JSON.parse(account).private_key,
    });
  });

  it('rejects an FCM service account that is not the JSON key file', () => {
    expect(withPush({ fcm: { serviceAccount: 'AIzaSy-not-a-key-file' } })).toThrowError(
      'channels.push.fcm.serviceAccount must be the contents of the service account JSON file',
    );
    expect(
      withPush({ fcm: { serviceAccount: serviceAccount({ private_key: undefined }) } }),
    ).toThrowError('channels.push.fcm.serviceAccount has no private_key');
  });
});
