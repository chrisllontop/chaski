// The admin API's JSON, as the dashboard reads it. Instants arrive as ISO
// strings with a UTC offset.

export type Channel = 'email' | 'in_app' | 'push';
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'dead' | 'skipped' | 'held';
export type Period = '7d' | '30d' | '90d';
export type Health = 'healthy' | 'at_risk' | 'blocked' | 'paused';

export type Actor = { id: string; name?: string };

export type Delivery = {
  id: string;
  notificationId: string;
  channel: Channel;
  status: DeliveryStatus;
  skipReason: string | null;
  attempts: number;
  lastError: string | null;
  errorCode: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  providerMs: number | null;
  openedAt: string | null;
  updatedAt: string;
  createdAt: string;
  type: string;
  recipientId: string;
  address: string | null;
  payload: Record<string, unknown>;
};

export type DeliveryPage = { deliveries: Delivery[]; total: number; page: number; limit: number };

export type Totals = {
  notifications: number;
  deliveries: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  sent: number;
  failed: number;
  dead: number;
  pending: number;
  skipped: number;
  opened: number;
  successRate: number | null;
  openRate: number | null;
};

export type Overview = Totals & {
  period: Period;
  from: string;
  to: string;
  previous: Totals;
  change: {
    notifications: number | null;
    sent: number | null;
    failed: number | null;
    opened: number | null;
  };
  topErrorCodes: Array<{ errorCode: string; count: number }>;
  skipReasons: Array<{ skipReason: string; count: number }>;
  scheduledPending: number;
};

export type DayOutcome = {
  date: string;
  notifications: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
};
export type Timeseries = { period: Period; from: string; series: DayOutcome[] };

export type TypeOutcome = {
  type: string;
  channel: Channel;
  volume: number;
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
  opened: number;
  successRate: number | null;
  health: Health;
};

export type TemplateSummary = {
  id: string;
  type: string;
  description: string | null;
  topic: string | null;
  updatedAt: string;
  contentUpdatedAt: string;
  lastUsedAt: string | null;
  channels: Array<{ channel: Channel; enabled: boolean }>;
};

export type DeletedTemplate = {
  id: string;
  type: string;
  description: string | null;
  topic: string | null;
  deletedAt: string;
};

export type TemplateChannelContent = {
  id: string;
  channel: Channel;
  enabled: boolean;
  subject: string | null;
  body: string | null;
  textBody: string | null;
};

export type TemplateDetail = {
  template: {
    id: string;
    type: string;
    description: string | null;
    topic: string | null;
    sampleData: string | null;
  };
  channels: TemplateChannelContent[];
};

export type RenderedPreview = { subject: string; html: string; text?: string };

export type ScheduledItem = {
  id: string;
  recipientId: string;
  type: string;
  scheduledAt: string;
  groupKey?: string;
  idempotencyKey?: string;
};

export type SchedulePage = {
  schedules: ScheduledItem[];
  total: number;
  page: number;
  limit: number;
};

export type ChannelPause = { pausedBy: Actor; pausedAt: string };

/** An Apple app push reaches: its bundle id and the APNs environment of its tokens. */
export type ApnsApp = { bundleId: string; environment: 'sandbox' | 'production' };

/** Who saved a section and when, and why it stopped working, if it did. */
export type SavedMeta = { updatedBy: Actor; updatedAt: string; problem: string | null };

export type EmailSettings = SavedMeta & {
  from: string | null;
  fromName: string | null;
  replyTo: string | null;
};

export type VapidSettings = SavedMeta & {
  subject: string | null;
  publicKey: string | null;
  privateKeySet: boolean;
};

export type ApnsSettings = SavedMeta & {
  teamId: string | null;
  keyId: string | null;
  privateKeySet: boolean;
  ios: ApnsApp | null;
  macos: ApnsApp | null;
};

export type FcmSettings = SavedMeta & {
  projectId: string | null;
  clientEmail: string | null;
  serviceAccountSet: boolean;
};

export type WnsSettings = SavedMeta & {
  tenantId: string | null;
  clientId: string | null;
  clientSecretSet: boolean;
};

export type PushProvider = 'vapid' | 'apns' | 'fcm' | 'wns';

export type ChannelsOverview = {
  /** Where this Worker runs, as CHASKI_ENVIRONMENT names it. */
  environment: string | null;
  realtime: boolean;
  /** Whether CHASKI_SECRET can seal the push credentials. */
  secret: 'set' | 'missing' | 'too_short';
  bindings: { email: boolean; feed: boolean };
  channels: [
    {
      channel: 'email';
      enabled: boolean;
      paused: ChannelPause | null;
      settings: EmailSettings | null;
    },
    {
      channel: 'in_app';
      enabled: boolean;
      paused: ChannelPause | null;
      settings: SavedMeta | null;
    },
    {
      channel: 'push';
      enabled: boolean;
      paused: ChannelPause | null;
      providers: {
        vapid: VapidSettings | null;
        apns: ApnsSettings | null;
        fcm: FcmSettings | null;
        wns: WnsSettings | null;
      };
    },
  ];
  defaultMutedTypes: {
    mutedTypes: string[];
    updatedBy: Actor | null;
    updatedAt: string | null;
    problem: string | null;
  };
};

export type Percentiles = { p50: number | null; p95: number | null };
export type LatencyStats = { count: number; toDeliver: Percentiles; provider: Percentiles };
export type Latency = {
  period: Period;
  from: string;
  overall: LatencyStats;
  channels: Array<LatencyStats & { channel: Channel }>;
  series: Array<{ date: string; count: number; p50: number | null; p95: number | null }>;
};
