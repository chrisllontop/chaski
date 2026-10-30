import type { ErrorHandler, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type ChaskiErrorCode, isChaskiError } from '../../contract/errors';
import { logger } from '../lib/log';
import { ready } from '../migrations';

const ERROR_STATUS: Record<ChaskiErrorCode, ContentfulStatusCode> = {
  validation: 400,
  config: 500,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  delivery_failed: 502,
  channel_paused: 503,
  internal: 500,
};

const log = logger('http');

export const handleError: ErrorHandler = (error, c) => {
  if (isChaskiError(error)) {
    if (error.code === 'internal' || error.code === 'config') {
      log.error('request failed', error, { code: error.code });
    }
    return c.json({ error: error.code, message: error.message }, ERROR_STATUS[error.code]);
  }
  log.error('unhandled error', error);
  return c.json({ error: 'internal', message: 'internal error' }, 500);
};

export const requireReady: MiddlewareHandler = async (_c, next) => {
  await ready();
  await next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The Access cookie rides along on cross-site requests, and a WebSocket upgrade
 * escapes CORS altogether, so a write or an upgrade from another origin is
 * refused. Browsers always send Origin on both; a request without one comes
 * from a server-side client.
 */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  const upgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket';
  if (SAFE_METHODS.has(c.req.method) && !upgrade) return next();
  const origin = c.req.header('origin');
  if (origin === undefined && c.req.header('sec-fetch-site') !== 'cross-site') return next();
  if (origin === new URL(c.req.url).origin) return next();
  return c.json({ error: 'forbidden', message: 'cross-origin request refused' }, 403);
};
