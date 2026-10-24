import type { ChaskiPreferences } from '../../contract/contract';
import { preferencesUpdateSchema } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { parseJson } from '../lib/json';
import { parseInput } from '../lib/validate';
import { BaseService } from './base.service';
import { TemplateService } from './template.service';

const assertRecipientId = (recipientId: string) => {
  if (!recipientId || recipientId.length > 256) {
    throw new ChaskiError('validation', 'recipientId must be 1-256 characters');
  }
};

export class PreferenceService extends BaseService {
  protected static override name = 'preferences';

  private static findSaved = async (recipientId: string): Promise<ChaskiPreferences | null> => {
    const row = await PreferenceService.client.preferences.findFirst({ where: { recipientId } });
    if (!row) return null;
    return {
      channels: parseJson<ChaskiPreferences['channels']>(row.channels, {}),
      mutedTypes: parseJson<string[]>(row.mutedTypes, []),
    };
  };

  // The host's default mutes hold until the recipient saves preferences of
  // their own, which then stand on their own instead of merging with them.
  private static defaults = (): ChaskiPreferences => ({
    channels: {},
    mutedTypes: PreferenceService.config.defaultMutedTypes,
  });

  static get = async (recipientId: string): Promise<ChaskiPreferences> => {
    assertRecipientId(recipientId);
    return (await PreferenceService.findSaved(recipientId)) ?? PreferenceService.defaults();
  };

  static set = async (recipientId: string, rawUpdate: unknown): Promise<ChaskiPreferences> => {
    assertRecipientId(recipientId);
    const update = parseInput(preferencesUpdateSchema, rawUpdate);
    const current = await PreferenceService.get(recipientId);
    const next: ChaskiPreferences = {
      channels: { ...current.channels, ...update.channels },
      mutedTypes: update.mutedTypes ?? current.mutedTypes,
    };

    await PreferenceService.client.preferences.upsertMany({
      data: [
        {
          recipientId,
          channels: JSON.stringify(next.channels),
          mutedTypes: JSON.stringify(next.mutedTypes),
        },
      ],
      target: ['recipientId'],
      update: ['channels', 'mutedTypes', 'updatedAt'],
    });
    return next;
  };

  static topics = (): Promise<Array<{ topic: string | null; types: string[] }>> =>
    TemplateService.topics();
}
