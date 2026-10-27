import type { ErrorHandler, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type ChaskiErrorCode, isChaskiError } from '../../contract/errors';
import { resolveConfig } from '../config';
import { logger } from '../lib/log';
import { reportError } from '../lib/report-error';
import { ready } from '../migrations';

const ERROR_STATUS: Record<ChaskiErrorCode, ContentfulStatusCode> = {
  validation: 400,
  config: 500,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  delivery_failed: 502,
  internal: 500,
};

const log = logger('http');

export const handleError: ErrorHandler = (error, c) => {
  if (isChaskiError(error)) {
    if (error.code === 'internal' || error.code === 'config') {
      reportError(error, { source: 'http' });
      log.error('request failed', error, { code: error.code });
    }
    return c.json({ error: error.code, message: error.message }, ERROR_STATUS[error.code]);
  }
  reportError(error, { source: 'http' });
  log.error('unhandled error', error);
  return c.json({ error: 'internal', message: 'internal error' }, 500);
};

export const requireReady: MiddlewareHandler = async (_c, next) => {
  await ready();
  await next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Session cookies ride along on cross-site requests, and a WebSocket upgrade
 * escapes CORS altogether, so a write or an upgrade from an origin other than
 * the request's own, publicUrl's or one listed here is refused. Browsers
 * always send Origin on both; a request without one comes from a server-side
 * client.
 */
export const sameOrigin =
  (allowedOrigins: string[] = []): MiddlewareHandler =>
  async (c, next) => {
    const upgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket';
    if (SAFE_METHODS.has(c.req.method) && !upgrade) return next();
    const origin = c.req.header('origin');
    if (origin === undefined && c.req.header('sec-fetch-site') !== 'cross-site') return next();
    const allowed = [
      new URL(c.req.url).origin,
      new URL(resolveConfig().publicUrl).origin,
      ...allowedOrigins,
    ];
    if (origin !== undefined && allowed.includes(origin)) return next();
    return c.json({ error: 'forbidden', message: 'cross-origin request refused' }, 403);
  };
