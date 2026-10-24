import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { assets } from '../src/generated/dashboard';

type Verdict = 'allow' | 'deny' | 'redirect';

const get = (path: string, verdict: Verdict = 'allow') =>
  exports.default.fetch(`https://host.test${path}`, {
    headers: { 'x-fixture-authorize': verdict },
    redirect: 'manual',
  });

const baseHref = async (response: Response) =>
  (await response.text()).match(/<base href="([^"]*)">/)?.[1];

const scriptAsset = Object.keys(assets).find((path) => path.endsWith('.js'));

describe('dashboard shell', () => {
  it.each([
    ['/chaski', '/chaski/'],
    ['/chaski/', '/chaski/'],
    ['/admin/notifications', '/admin/notifications/'],
    ['/admin/notifications/', '/admin/notifications/'],
  ])('serves %s with the base path %s', async (path, expected) => {
    const response = await get(path);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await baseHref(response)).toBe(expected);
  });

  it('serves deep links so the dashboard can route them', async () => {
    const response = await get('/chaski/templates/welcome');

    expect(response.status).toBe(200);
    expect(await baseHref(response)).toBe('/chaski/');
  });

  it('is never cached and only loads same-origin resources', async () => {
    const response = await get('/chaski');

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
});

describe('dashboard assets', () => {
  it('found a built script to test against', () => {
    expect(scriptAsset).toBeDefined();
  });

  it.each(['/chaski', '/admin/notifications'])('serves hashed assets under %s', async (mount) => {
    const response = await get(`${mount}/${scriptAsset}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('answers 404 for a missing asset instead of falling back to the shell', async () => {
    const response = await get('/chaski/assets/missing-0000.js');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toContain('text/html');
  });

  it('serves assets without asking authorize', async () => {
    const response = await get(`/chaski/${scriptAsset}`, 'deny');

    expect(response.status).toBe(200);
  });
});

describe('authorize', () => {
  it('blocks the shell when it returns false', async () => {
    const response = await get('/chaski/templates/welcome', 'deny');

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).not.toContain('text/html');
  });

  it('blocks the API with a JSON error when it returns false', async () => {
    const response = await get('/chaski/api/templates', 'deny');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('passes a returned response through untouched', async () => {
    const response = await get('/chaski', 'redirect');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login');
  });
});

describe('API', () => {
  it('answers 404 in JSON once authorize lets the request in', async () => {
    const response = await get('/chaski/api/whatever');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

describe('host', () => {
  it('keeps serving its own routes', async () => {
    const response = await get('/');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Host home');
  });
});
