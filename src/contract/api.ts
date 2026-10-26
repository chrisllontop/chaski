import type {
  CancelScheduledQuery,
  ChaskiPreferences,
  FeedPage,
  ListFeedQuery,
  MarkFeedReadInput,
  PreferencesUpdate,
  RegisterPushSubscriptionRequest,
  ScheduledItem,
  ScheduleRequest,
  ScheduleResult,
  SendRequest,
  SendResult,
  UnregisterPushSubscriptionQuery,
} from './contract';

export interface ChaskiSchedulesApi {
  /** Pending schedules, soonest first. */
  list(query?: { recipientId?: string }): Promise<ScheduledItem[]>;
  cancel(query: CancelScheduledQuery): Promise<{ cancelled: number }>;
}

export interface ChaskiPushApi {
  /** Registers a device; registering a known endpoint or token hands it to this recipient. */
  register(request: RegisterPushSubscriptionRequest): Promise<{ id: string }>;
  unregister(query: UnregisterPushSubscriptionQuery): Promise<{ unregistered: number }>;
  /** The applicationServerKey for pushManager.subscribe(); null until VAPID is configured. */
  vapidPublicKey(): Promise<{ publicKey: string | null }>;
}

export interface ChaskiPreferencesApi {
  get(recipientId: string): Promise<ChaskiPreferences>;
  set(recipientId: string, update: PreferencesUpdate): Promise<ChaskiPreferences>;
  /** Template types grouped by topic, to build a preferences screen from. */
  topics(): Promise<Array<{ topic: string | null; types: string[] }>>;
}

export interface ChaskiFeedApi {
  list(query: ListFeedQuery): Promise<FeedPage>;
  unreadCount(recipientId: string): Promise<{ unread: number }>;
  markRead(input: MarkFeedReadInput): Promise<{ marked: number }>;
}

/** Chaski's in-process API: the host's Worker calls it directly, with no HTTP in between. */
export interface ChaskiApi {
  send(request: SendRequest): Promise<SendResult>;
  /** Sends later, at scheduledAt; needs the ChaskiScheduler Workflow binding. */
  schedule(request: ScheduleRequest): Promise<ScheduleResult>;
  readonly schedules: ChaskiSchedulesApi;
  readonly push: ChaskiPushApi;
  readonly preferences: ChaskiPreferencesApi;
  readonly feed: ChaskiFeedApi;
}
