import { createFeedClient, type FeedClient, type FeedOptions } from './feed';
import { createRequest } from './http';
import { createPreferencesClient, type PreferencesClient } from './preferences';
import { createPushClient, type PushClient, type PushOptions } from './push';

export type ChaskiClientOptions = {
  /** Where the host mounted chaski.userRoutes(), e.g. `/me/notifications` or a full URL. */
  baseUrl: string;
  /**
   * Used instead of the global fetch; a frontend on another origin passes one with
   * `credentials: 'include'` so its session cookie goes along.
   */
  fetch?: typeof fetch;
  feed?: FeedOptions;
  push?: PushOptions;
};

export type ChaskiClient = {
  feed: FeedClient;
  push: PushClient;
  preferences: PreferencesClient;
};

/** The browser side of chaski.userRoutes(): the signed-in user's feed, push and preferences. */
export const createChaskiClient = (options: ChaskiClientOptions): ChaskiClient => {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  // Bound late, so a global fetch stubbed after this call (by a test, say) still applies.
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const request = createRequest(baseUrl, fetcher);
  const feed = createFeedClient(request, baseUrl, options.feed);
  return {
    feed,
    push: createPushClient(request, options.push, feed),
    preferences: createPreferencesClient(request),
  };
};

export type {
  ChaskiPreferences,
  FeedItem,
  FeedPage,
  FeedSocketEvent,
  NativeDevice,
  PreferencesUpdate,
} from '../contract/contract';
export type { ChaskiErrorCode } from '../contract/errors';
export type {
  FeedClient,
  FeedConnectionStatus,
  FeedListener,
  FeedListQuery,
  FeedOptions,
} from './feed';
export { ChaskiRequestError } from './http';
export type { PreferencesClient } from './preferences';
export type { PushClient, PushOptions, PushState, RegisterDeviceOptions } from './push';
export { CHASKI_QUERY_KEY, chaskiQueries, type QueryDescriptor } from './queries';
