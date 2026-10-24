import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { reportError } from '../lib/report-error';
import { ScheduleService } from '../services/schedule.service';
import type { ScheduleParams } from '../types';

// Each attempt reads the schedule again, so moving it later sends the instance
// back to sleep and a failed send gets another try; the cap bounds both.
const MAX_ATTEMPTS = 50;

const SEND_STEP = {
  retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' },
  timeout: '5 minutes',
} as const;

// Once the step's own retries are spent (a long D1 outage, say), the instance
// sleeps and tries again instead of erroring, so a schedule is never dropped
// on a transient failure. A sleeping instance costs nothing; 50 attempts at
// this pace cover about 12 hours.
const RETRY_BACKOFF = '15 minutes';

/** One instance per scheduled notification: it sleeps until scheduledAt, then sends. */
export class ChaskiScheduler extends WorkflowEntrypoint<unknown, ScheduleParams> {
  override async run(event: WorkflowEvent<ScheduleParams>, step: WorkflowStep): Promise<void> {
    const { scheduledId } = event.payload;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const target = await step.do(`resolve ${attempt}`, () =>
        ScheduleService.workflowTarget(scheduledId),
      );
      // Cancelled, sent or gone: nothing left to do.
      if (!target) return;
      if (!target.due) {
        await step.sleepUntil(`wait ${attempt}`, target.scheduledAtMs);
        continue;
      }
      try {
        await step.do(`send ${attempt}`, SEND_STEP, () => ScheduleService.fire(scheduledId));
        return;
      } catch (error) {
        reportError(error, { source: 'workflow', scheduledId });
        // fire() is idempotent (status guard plus a derived idempotency key),
        // so trying again after a partial failure never sends twice.
        await step.sleep(`backoff ${attempt}`, RETRY_BACKOFF);
      }
    }
  }
}
