import { eq } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import type { Actor } from '../auth';
import { baseConfig } from '../config';
import { channelPauses } from '../db/schema';
import { publishAdminEvents } from '../lib/admin-events';
import { secretStatus } from '../lib/sealed';
import { BaseService } from './base.service';
import { DeliveryAdminService } from './delivery-admin.service';
import { SettingsService } from './settings.service';

export type ChannelPause = { pausedBy: Actor; pausedAt: string };

export class ChannelService extends BaseService {
  protected static override name = 'channels';

  /**
   * Which channels are on and paused, and the settings saved for each, without a single secret:
   * a secret only reports that it is set.
   */
  static overview = async () => {
    const { enabledChannels, environment, bindings } = ChannelService.config;
    const [pauses, saved] = await Promise.all([
      ChannelService.pauses(),
      SettingsService.sections(),
    ]);
    const state = (channel: Channel) => ({
      channel,
      enabled: enabledChannels.includes(channel),
      paused: pauses.get(channel) ?? null,
    });
    return {
      environment,
      // Without the ChaskiEvents binding the dashboard refreshes on its own instead of live.
      realtime: Boolean(bindings.events),
      // Push credentials are sealed with CHASKI_SECRET, so they can't be saved without it.
      secret: secretStatus(baseConfig().secret),
      // Email and in-app can't be turned on without these, whatever is saved.
      bindings: { email: Boolean(bindings.email), feed: Boolean(bindings.feed) },
      channels: [
        { ...state('email'), settings: saved.email },
        { ...state('in_app'), settings: saved.in_app },
        {
          ...state('push'),
          providers: { vapid: saved.vapid, apns: saved.apns, fcm: saved.fcm, wns: saved.wns },
        },
      ],
      defaultMutedTypes: saved.defaultMutedTypes,
    };
  };

  static pauses = async (): Promise<Map<Channel, ChannelPause>> => {
    const rows = await ChannelService.client.channelPauses.findMany({});
    return new Map(
      rows.map((row) => [
        row.channel as Channel,
        {
          pausedBy: { id: row.pausedById, name: row.pausedByName ?? undefined },
          pausedAt: row.pausedAt.toISOString(),
        },
      ]),
    );
  };

  // Read for every delivery rather than cached, so a pause stops the very next one in any isolate.
  static isPaused = async (channel: string): Promise<boolean> =>
    (await ChannelService.client.channelPauses.findFirst({ where: { channel } })) !== null;

  /** Holds every delivery of the channel from now on, until someone resumes it. */
  static pause = async (channel: Channel, actor: Actor): Promise<void> => {
    if (!ChannelService.config.enabledChannels.includes(channel)) {
      throw new ChaskiError('validation', `the ${channel} channel is not configured`);
    }
    // Pausing a paused channel keeps who stopped it first.
    const result = await ChannelService.db
      .insert(channelPauses)
      .values({
        channel,
        pausedById: actor.id,
        pausedByName: actor.name ?? null,
        pausedAt: new Date(),
      })
      .onConflictDoNothing();
    if (result.meta.changes === 0) return;
    ChannelService.log.warn('channel paused', { channel, actor: actor.id });
    await publishAdminEvents(['channels']);
  };

  /**
   * Lets the channel deliver again. What it held stays held unless `send` asks to send it now;
   * otherwise someone sends or discards it from the deliveries.
   */
  static resume = async (
    channel: Channel,
    actor: Actor,
    options: { send: boolean },
  ): Promise<{ sent: number }> => {
    const result = await ChannelService.db
      .delete(channelPauses)
      .where(eq(channelPauses.channel, channel));
    if (result.meta.changes === 0) {
      throw new ChaskiError('conflict', `the ${channel} channel isn't paused`);
    }
    ChannelService.log.info('channel resumed', { channel, actor: actor.id, send: options.send });
    const { sent } = options.send ? await DeliveryAdminService.sendHeld({ channel }) : { sent: 0 };
    await publishAdminEvents(['channels', 'deliveries']);
    return { sent };
  };
}
