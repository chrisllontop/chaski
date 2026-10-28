// A due schedule fires within seconds, and a failed fire tries again 15 minutes later, so one
// still pending a minute after its time is stuck: a fire that keeps failing, or, under
// wrangler dev, an instance that slept through a restart of the dev server.
const OVERDUE_AFTER_MS = 60_000;

export const isOverdue = (scheduledAt: string, now = Date.now()): boolean =>
  Date.parse(scheduledAt) < now - OVERDUE_AFTER_MS;
