import { and, eq, inArray } from 'drizzle-orm';
import {
  registerPushSubscriptionSchema,
  unregisterPushSubscriptionSchema,
} from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { type DevicePlatform, deviceTokens } from '../db/schema';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { parseInput } from '../lib/validate';
import { BaseService } from './base.service';
import { ContactService } from './contact.service';

export type WebPushDevice = {
  id: string;
  platform: 'web';
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type ApnsPushDevice = {
  id: string;
  platform: 'ios';
  deviceToken: string;
};

export type FcmPushDevice = {
  id: string;
  platform: 'android';
  deviceToken: string;
};

export type PushDevice = WebPushDevice | ApnsPushDevice | FcmPushDevice;

type StoredMeta = {
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
};

export class PushSubscriptionService extends BaseService {
  protected static override name = 'push';

  // The endpoint (web) or device token (iOS, Android) is the row's identity: it names
  // one installation, which one recipient owns at a time. Registering a token
  // that exists hands it to the new recipient, so a user who signed out
  // without unregistering stops getting pushes on the next user's device.
  static register = async (rawRequest: unknown): Promise<{ id: string }> => {
    const request = parseInput(registerPushSubscriptionSchema, rawRequest);
    await ContactService.upsertFromRecipient(request.recipient);

    const device =
      'subscription' in request
        ? {
            platform: 'web' as const,
            token: request.subscription.endpoint,
            meta: {
              keys: request.subscription.keys,
              userAgent: request.userAgent,
            } satisfies StoredMeta,
          }
        : {
            platform: request.platform,
            // APNs tokens are case-insensitive hex; FCM tokens are kept as they came.
            token:
              request.platform === 'ios' ? request.deviceToken.toLowerCase() : request.deviceToken,
            meta: { userAgent: request.userAgent } satisfies StoredMeta,
          };

    await PushSubscriptionService.client.deviceTokens.upsertMany({
      data: [
        {
          id: newId('dt'),
          recipientId: request.recipient.id,
          platform: device.platform,
          token: device.token,
          meta: JSON.stringify(device.meta),
        },
      ],
      target: ['token'],
      update: ['recipientId', 'platform', 'meta'],
    });

    const row = await PushSubscriptionService.client.deviceTokens.findFirst({
      where: { recipientId: request.recipient.id, token: device.token },
    });
    if (!row) throw new ChaskiError('internal', 'the push subscription was not stored');
    return { id: row.id };
  };

  static unregister = async (rawQuery: unknown): Promise<{ unregistered: number }> => {
    const query = parseInput(unregisterPushSubscriptionSchema, rawQuery);

    const conditions = [];
    if (query.recipientId) conditions.push(eq(deviceTokens.recipientId, query.recipientId));
    if (query.endpoint) conditions.push(eq(deviceTokens.token, query.endpoint));
    // The query doesn't name the platform: an APNs token is stored lowercased,
    // an FCM token as it was registered.
    if (query.deviceToken) {
      const { deviceToken } = query;
      conditions.push(inArray(deviceTokens.token, [deviceToken, deviceToken.toLowerCase()]));
    }

    const result = await PushSubscriptionService.db.delete(deviceTokens).where(and(...conditions));
    return { unregistered: result.meta.changes };
  };

  static listForRecipient = async (recipientId: string): Promise<PushDevice[]> => {
    const rows = await PushSubscriptionService.client.deviceTokens.findMany({
      where: { recipientId },
    });
    return rows.flatMap((row): PushDevice[] => {
      if (row.platform === 'ios') {
        return [{ id: row.id, platform: 'ios', deviceToken: row.token }];
      }
      if (row.platform === 'android') {
        return [{ id: row.id, platform: 'android', deviceToken: row.token }];
      }
      const meta = parseJson<StoredMeta>(row.meta, {});
      if (row.platform !== 'web' || !meta.keys?.p256dh || !meta.keys?.auth) return [];
      return [
        {
          id: row.id,
          platform: 'web',
          endpoint: row.token,
          keys: { p256dh: meta.keys.p256dh, auth: meta.keys.auth },
        },
      ];
    });
  };

  /** The platforms the host configured push credentials for. */
  static configuredPlatforms = (): DevicePlatform[] => {
    const push = PushSubscriptionService.config.channels.push;
    const platforms: DevicePlatform[] = [];
    if (push?.vapid) platforms.push('web');
    if (push?.apns) platforms.push('ios');
    if (push?.fcm) platforms.push('android');
    return platforms;
  };

  // A web device without VAPID, an iOS device without APNs or an Android
  // device without FCM can't be reached, so it does not count.
  static hasReachableDevice = (recipientId: string): Promise<boolean> =>
    PushSubscriptionService.client.deviceTokens.exists({
      where: { recipientId, platform: { in: PushSubscriptionService.configuredPlatforms() } },
    });

  static removeByIds = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await PushSubscriptionService.db.delete(deviceTokens).where(inArray(deviceTokens.id, ids));
  };
}
