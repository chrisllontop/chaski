import { CHASKI_ERROR_CODES, ChaskiError, type ChaskiErrorCode } from '../contract/errors';

/** An error answer from chaski's user routes, with its HTTP status. */
export class ChaskiRequestError extends ChaskiError {
  readonly status: number;

  constructor(status: number, code: ChaskiErrorCode, message: string) {
    super(code, message);
    this.status = status;
  }
}

export type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export const createRequest =
  (baseUrl: string, fetcher: typeof fetch): Request =>
  async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetcher(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      message?: unknown;
    };
    if (!response.ok) {
      const code = CHASKI_ERROR_CODES.find((known) => known === data.error) ?? 'internal';
      const message =
        typeof data.message === 'string' ? data.message : `request failed with ${response.status}`;
      throw new ChaskiRequestError(response.status, code, message);
    }
    return data as T;
  };
