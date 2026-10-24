import type { AdminEventTopic } from '../../contract/admin-events';
import { eventsStub } from '../durable/events';
import { logger } from './log';
import { reportError } from './report-error';

// The change is already stored when this runs, so a lost invalidation must
// never fail or repeat the operation that made it.
export const publishAdminEvents = async (topics: AdminEventTopic[]): Promise<void> => {
  try {
    await eventsStub()?.publish(topics);
  } catch (error) {
    reportError(error, { source: 'events' });
    logger('events').error('invalidation failed', error);
  }
};
