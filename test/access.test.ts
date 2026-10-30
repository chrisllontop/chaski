import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../src/generated/dashboard';
import { api, CHASKI_URL, signedIn } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const fetchChaski = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(`${CHASKI_URL}${path}`, init);

describe('Cloudflare Access', () => {
  it('lets in the identity Access signed in', async () => {
    const response = await api('/me', {
      headers: signedIn({ email: 'ana@example.com', name: 'Ana' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actor: { id: 'ana@example.com', name: 'Ana' } });
  });

  // A request Access never saw reaches the Worker through a URL Access doesn't cover.
  it('refuses a request Access never saw, the API and the dashboard alike', async () => {
    const apiResponse = await fetchChaski('/api/templates');
    const page = await fetchChaski('/templates');

    expect(apiResponse.status).toBe(403);
    expect(await apiResponse.json()).toEqual({
      error: 'forbidden',
      message: 'turn on Cloudflare Access for this Worker',
    });
    expect(page.status).toBe(403);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a request Access let through without an identity', async () => {
    const response = await fetchChaski('/api/templates', {
      headers: { 'MF-Access-Blob': JSON.stringify({ app_aud: 'chaski-fixture' }) },
    });

    expect(response.status).toBe(403);
  });

  it('takes the user id when the identity has no email', async () => {
    const response = await api('/me', { headers: signedIn({ user_uuid: 'u_1' }) });

    expect(await response.json()).toEqual({ actor: { id: 'u_1' } });
  });

  it('serves the dashboard assets without an identity', async () => {
    const script = Object.keys(assets).find((path) => path.endsWith('.js'));

    expect((await fetchChaski(`/${script}`)).status).toBe(200);
  });

  it('logs every change under the actor it let in', async () => {
    const info = vi.spyOn(console, 'info');

    await api('/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'welcome' }),
      headers: signedIn({ email: 'ana@example.com' }),
    });

    expect(info).toHaveBeenCalledWith(
      '[chaski:admin]',
      'admin action',
      expect.objectContaining({ actor: 'ana@example.com', method: 'POST', status: 201 }),
    );
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
    const response = await fetchChaski('/api/events', {
      headers: { upgrade: 'websocket', origin: 'https://attacker.test', ...signedIn() },
    });

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it('accepts server-side clients without an origin', async () => {
    const response = await fetchChaski('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'digest' }),
      headers: { 'content-type': 'application/json', ...signedIn() },
    });

    expect(response.status).toBe(201);
  });

  it('refuses a cross-site request that hides its origin', async () => {
    const response = await fetchChaski('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ type: 'welcome' }),
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
        ...signedIn(),
      },
    });

    expect(response.status).toBe(403);
  });
});
