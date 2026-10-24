import type {
  FeedPage,
  ListFeedQuery,
  MarkFeedReadInput,
  RegisterPushSubscriptionRequest,
  SendRequest,
  SendResult,
  UnregisterPushSubscriptionQuery,
} from './contract';

export interface ChaskiPushApi {
  /** Registers a device; registering a known endpoint or token hands it to this recipient. */
  register(request: RegisterPushSubscriptionRequest): Promise<{ id: string }>;
  unregister(query: UnregisterPushSubscriptionQuery): Promise<{ unregistered: number }>;
  /** The applicationServerKey for pushManager.subscribe(); null until VAPID is configured. */
  vapidPublicKey(): Promise<{ publicKey: string | null }>;
}

export interface ChaskiFeedApi {
  list(query: ListFeedQuery): Promise<FeedPage>;
  unreadCount(recipientId: string): Promise<{ unread: number }>;
  markRead(input: MarkFeedReadInput): Promise<{ marked: number }>;
}

/** chaski's in-process API: the host's Worker calls it directly, with no HTTP in between. */
export interface ChaskiApi {
  send(request: SendRequest): Promise<SendResult>;
  readonly push: ChaskiPushApi;
  readonly feed: ChaskiFeedApi;
}
