import type { SendRequest, SendResult } from './contract';

/** chaski's in-process API: the host's Worker calls it directly, with no HTTP in between. */
export interface ChaskiApi {
  send(request: SendRequest): Promise<SendResult>;
}
