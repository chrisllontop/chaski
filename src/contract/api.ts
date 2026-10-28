import type {
  CancelScheduledQuery,
  Channel,
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
import type { TemplateFile, TemplateImportResult } from './template-file';

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

export interface ChaskiTemplatesApi {
  /**
   * Creates or overwrites templates by type from a template file; `preview` only reports. The
   * file is validated here, so a JSON import whose fields TypeScript widens to strings fits.
   */
  import(file: unknown, options?: { preview?: boolean }): Promise<TemplateImportResult>;
  /** Every live template, as the file `import` takes. */
  export(): Promise<TemplateFile>;
}

export interface ChaskiFeedApi {
  list(query: ListFeedQuery): Promise<FeedPage>;
  unreadCount(recipientId: string): Promise<{ unread: number }>;
  markRead(input: MarkFeedReadInput): Promise<{ marked: number }>;
}

/**
 * What `ready()` found: the channels the config turns on and which of them are paused, whether
 * it's a dry run, and how many templates there are; with none, every send is refused as an
 * unknown type.
 */
export type ChaskiReadiness = {
  channels: Channel[];
  paused: Channel[];
  dryRun: boolean;
  templates: number;
};

/** Chaski's in-process API: the host's Worker calls it directly, with no HTTP in between. */
export interface ChaskiApi {
  /**
   * Checks the config, asks the database for the applied migrations and counts the templates,
   * changing nothing; throws the `config` error a send would, for a health check.
   */
  ready(): Promise<ChaskiReadiness>;
  send(request: SendRequest): Promise<SendResult>;
  /** Sends later, at scheduledAt; needs the ChaskiScheduler Workflow binding. */
  schedule(request: ScheduleRequest): Promise<ScheduleResult>;
  readonly schedules: ChaskiSchedulesApi;
  readonly push: ChaskiPushApi;
  readonly preferences: ChaskiPreferencesApi;
  readonly feed: ChaskiFeedApi;
  readonly templates: ChaskiTemplatesApi;
}
