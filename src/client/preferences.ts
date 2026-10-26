import type { ChaskiPreferences, PreferencesUpdate } from '../contract/contract';
import type { Request } from './http';

export type PreferencesClient = {
  get(): Promise<ChaskiPreferences>;
  /** Channels merge key by key; mutedTypes, when given, overwrites the whole list. */
  update(update: PreferencesUpdate): Promise<ChaskiPreferences>;
  /** Template types grouped by topic, to build a preferences screen from. */
  topics(): Promise<Array<{ topic: string | null; types: string[] }>>;
};

export const createPreferencesClient = (request: Request): PreferencesClient => ({
  get: () => request('GET', '/preferences'),
  update: (update) => request('PATCH', '/preferences', update),
  topics: () => request('GET', '/preferences/topics'),
});
