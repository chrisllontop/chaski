import { BaseService } from './base.service';

export class ChannelService extends BaseService {
  protected static override name = 'channels';

  /** The channels the host configured, without a single secret. */
  static overview = () => {
    const { channels, dryRun, bindings } = ChannelService.config;
    const { email, push } = channels;
    return {
      dryRun,
      // Without the ChaskiEvents binding the dashboard refreshes on its own instead of live.
      realtime: Boolean(bindings.events),
      channels: [
        {
          channel: 'email' as const,
          enabled: Boolean(email),
          from: email?.from ?? null,
          fromName: email?.fromName ?? null,
          replyTo: email?.replyTo ?? null,
        },
        { channel: 'in_app' as const, enabled: Boolean(channels.in_app) },
        {
          channel: 'push' as const,
          enabled: Boolean(push),
          web: push?.vapid ? { vapidPublicKey: push.vapid.publicKey } : null,
          ios: push?.apns
            ? { bundleId: push.apns.bundleId, environment: push.apns.environment }
            : null,
        },
      ],
    };
  };
}
