export const CHASKI_ERROR_CODES = [
  'validation',
  'config',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'internal',
] as const;

export type ChaskiErrorCode = (typeof CHASKI_ERROR_CODES)[number];

export class ChaskiError extends Error {
  readonly code: ChaskiErrorCode;

  constructor(code: ChaskiErrorCode, message: string) {
    super(message);
    // name and code are own properties, so they survive serialization across a
    // service binding or a queue; class identity does not, so detection goes
    // through isChaskiError, never instanceof.
    this.name = 'ChaskiError';
    this.code = code;
  }
}

export const isChaskiError = (e: unknown): e is ChaskiError =>
  e instanceof Error &&
  e.name === 'ChaskiError' &&
  typeof (e as { code?: unknown }).code === 'string';

/** Retry policy for queue consumers: Chaski codes other than `internal` are
 * permanent (caller bug or config error; retrying cannot fix them).
 * Other errors (network, runtime) are assumed transient. */
export const isRetryableChaskiError = (e: unknown): boolean =>
  isChaskiError(e) ? e.code === 'internal' : true;
