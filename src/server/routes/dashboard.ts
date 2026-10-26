import type { Context } from 'hono';
import { basePath } from 'hono/route';
import { assets, shell } from '../../generated/dashboard';

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

// The host picks the mount path in app.route(), so Chaski reads it per request instead of asking
// for it twice. A parameterized mount resolves to the concrete path.
export const mountPath = (c: Context): string => basePath(c).replace(/\/$/, '');

export const relativePath = (c: Context): string => c.req.path.slice(mountPath(c).length);

export const isApi = (c: Context): boolean => {
  const path = relativePath(c);
  return path === '/api' || path.startsWith('/api/');
};

const escapeAttribute = (value: string) =>
  value.replace(/[&"<>]/g, (character) => `&#${character.charCodeAt(0)};`);

const decodeBase64 = (body: string) => Uint8Array.from(atob(body), (c) => c.charCodeAt(0));

export const serveAsset = (c: Context): Response => {
  const asset = assets[relativePath(c).slice(1)];
  if (!asset) {
    return c.text('Not found', 404);
  }
  return c.body(asset.base64 ? decodeBase64(asset.body) : asset.body, 200, {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': asset.type,
    'X-Content-Type-Options': 'nosniff',
  });
};

// Vite builds with relative URLs; the base element resolves them against the mount path, so deep
// links load the same assets as the root.
export const serveShell = (c: Context): Response | Promise<Response> =>
  c.html(shell.replace('<head>', `<head><base href="${escapeAttribute(mountPath(c))}/">`), 200, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': contentSecurityPolicy,
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  });
