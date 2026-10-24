import { exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Authorize, basicAuth, cloudflareAccess } from '../src';
import { encodeBase64Url, encodeBase64UrlJson } from '../src/server/lib/base64';
import { chaski } from './fixture/worker';
import { api } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const mounted = (authorize: Authorize) =>
  new Hono().route('/chaski', chaski.routes({ dashboard: { authorize } }));

describe('authorize', () => {
  it('logs every change under the actor it let in', async () => {
    const info = vi.spyOn(console, 'info');

    await api('/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'welcome' }),
      headers: { 'x-fixture-actor': 'ana@host.test' },
    });

    expect(info).toHaveBeenCalledWith(
      '[chaski:admin]',
      'admin action',
      expect.objectContaining({ actor: 'ana@host.test', method: 'POST', status: 201 }),
    );
  });

  it('refuses an actor without an id', async () => {
    const response = await mounted(() => ({ id: '' })).request('/chaski/api/templates');

    expect(response.status).toBe(403);
  });
});

describe('origin check', () => {
  it('refuses a write from another origin', async () => {
    const response = await api('/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'welcome' }),
      headers: { origin: 'https://attacker.test' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden',
      message: 'cross-origin request refused',
    });
  });

  it('refuses a WebSocket upgrade from another origin', async () => {
    const response = await exports.default.fetch('https://host.test/chaski/api/events', {
      headers: { upgrade: 'websocket', origin: 'https://attacker.test' },
    });

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it('accepts the publicUrl origin and server-side clients without one', async () => {
    const fromPublicUrl = await api('/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'welcome' }),
      headers: { origin: 'http://localhost:8787' },
    });
    const serverSide = await exports.default.fetch('https://host.test/chaski/api/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'digest' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(fromPublicUrl.status).toBe(201);
    expect(serverSide.status).toBe(201);
  });

  it('refuses a cross-site request that hides its origin', async () => {
    const response = await exports.default.fetch('https://host.test/chaski/api/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'welcome' }),
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    });

    expect(response.status).toBe(403);
  });
});

const generateRsa = async () =>
  (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;

const teamKey = await generateRsa();
const strangerKey = await generateRsa();
const jwk = {
  ...((await crypto.subtle.exportKey('jwk', teamKey.publicKey)) as JsonWebKey),
  kid: 'key-1',
};

describe('cloudflareAccess', () => {
  const TEAM = 'https://team.cloudflareaccess.com';
  const AUD = 'aud-tag-1';

  const sign = async (claims: Record<string, unknown>, key = teamKey.privateKey) => {
    const input = `${encodeBase64UrlJson({ alg: 'RS256', kid: 'key-1' })}.${encodeBase64UrlJson(claims)}`;
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(input),
    );
    return `${input}.${encodeBase64Url(new Uint8Array(signature))}`;
  };

  const now = () => Math.floor(Date.now() / 1000);
  const claims = (overrides: Record<string, unknown> = {}) => ({
    iss: TEAM,
    aud: [AUD],
    email: 'ana@host.test',
    sub: 'user-1',
    exp: now() + 300,
    ...overrides,
  });

  const request = async (token?: string) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      expect(String(input)).toBe(`${TEAM}/cdn-cgi/access/certs`);
      return Response.json({ keys: [jwk] });
    });
    const app = mounted(
      cloudflareAccess({ teamDomain: 'team.cloudflareaccess.com', audience: AUD }),
    );
    return app.request(
      '/chaski/api/channels',
      token ? { headers: { 'cf-access-jwt-assertion': token } } : {},
    );
  };

  it('lets in a valid token', async () => {
    expect((await request(await sign(claims()))).status).toBe(200);
  });

  it.each([
    ['an expired token', claims({ exp: now() - 60 })],
    ['another application', claims({ aud: ['aud-tag-2'] })],
    ['another team', claims({ iss: 'https://other.cloudflareaccess.com' })],
    ['a token not yet valid', claims({ nbf: now() + 300 })],
  ])('refuses %s', async (_case, tokenClaims) => {
    expect((await request(await sign(tokenClaims))).status).toBe(403);
  });

  it('refuses a token signed by another key', async () => {
    expect((await request(await sign(claims(), strangerKey.privateKey))).status).toBe(403);
  });

  it('refuses a request without a token', async () => {
    expect((await request()).status).toBe(403);
  });
});

describe('basicAuth', () => {
  const app = mounted(basicAuth({ username: 'ops', password: 'correct horse' }));
  const withCredentials = (credentials: string) =>
    app.request('/chaski/api/channels', {
      headers: { authorization: `Basic ${btoa(credentials)}` },
    });

  it('asks the browser for credentials', async () => {
    const response = await app.request('/chaski/api/channels');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="Chaski", charset="UTF-8"');
  });

  it('lets in the right credentials and nothing else', async () => {
    expect((await withCredentials('ops:correct horse')).status).toBe(200);
    expect((await withCredentials('ops:wrong')).status).toBe(401);
    expect((await withCredentials('root:correct horse')).status).toBe(401);
  });

  it('needs a username and a password', () => {
    expect(() => basicAuth({ username: 'ops', password: '' })).toThrowError(
      'Chaski config: basicAuth needs a username and a password',
    );
  });
});
