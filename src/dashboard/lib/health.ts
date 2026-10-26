import type { Health, TypeOutcome } from './types';

// A paused channel sent nothing, so any channel that did send outranks it.
const SEVERITY: Record<Health, number> = { paused: 0, healthy: 1, at_risk: 2, blocked: 3 };

/** Each type's worst health across its channels; types with no deliveries are absent. */
export const healthByType = (rows: Pick<TypeOutcome, 'type' | 'health'>[]) => {
  const byType = new Map<string, Health>();
  for (const { type, health } of rows) {
    const current = byType.get(type);
    if (!current || SEVERITY[health] > SEVERITY[current]) byType.set(type, health);
  }
  return byType;
};
