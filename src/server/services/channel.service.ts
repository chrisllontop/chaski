import { eq } from 'drizzle-orm';
import type { Channel } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import type { Actor } from '../auth';
import { channelPauses } from '../db/schema';
import { publishAdminEvents } from '../lib/admin-events';
import { BaseService } from './base.service';
import { DeliveryAdminService } from './delivery-admin.service';

export type ChannelPause = { pausedBy: Actor; pausedAt: string };

export class ChannelService extends BaseService {
  protected static override name = 'channels';

  /** The channels the host configured, without a single secret, and which of them are paused. */
  static overview = async () => {
    const { channels, environment, bindings } = ChannelService.config;
    const { email, push } = channels;
    const pauses = await ChannelService.pauses();
    const pauseOf = (channel: Channel) => pauses.get(channel) ?? null;
    return {
      environment,
      // Without the ChaskiEvents binding the dashboard refreshes on its own instead of live.
      realtime: Boolean(bindings.events),
      channels: [
        {
          channel: 'email' as const,
          enabled: Boolean(email),
          paused: pauseOf('email'),
          from: email?.from ?? null,
          fromName: email?.fromName ?? null,
          replyTo: email?.replyTo ?? null,
        },
        {
          channel: 'in_app' as const,
          enabled: Boolean(channels.in_app),
          paused: pauseOf('in_app'),
        },
        {
          channel: 'push' as const,
          enabled: Boolean(push),
          paused: pauseOf('push'),
          web: push?.vapid ? { vapidPublicKey: push.vapid.publicKey } : null,
          ios: push?.apns
            ? { bundleId: push.apns.bundleId, environment: push.apns.environment }
            : null,
          android: push?.fcm ? { projectId: push.fcm.projectId } : null,
        },
      ],
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
