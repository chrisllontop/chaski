// The dashboard's realtime socket carries invalidations, never data: the
// dashboard refetches over the admin API, so authorization and response
// shapes live in one place. Clients ignore topics they don't know, so the
// list can grow without breaking an older dashboard.
export const ADMIN_EVENT_TOPICS = ['deliveries', 'metrics', 'templates', 'channels'] as const;

export type AdminEventTopic = (typeof ADMIN_EVENT_TOPICS)[number];

export type AdminSocketEvent = {
  type: 'invalidate';
  topics: AdminEventTopic[];
  at: string;
};
