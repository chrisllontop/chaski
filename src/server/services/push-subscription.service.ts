import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import {
  registerPushSubscriptionSchema,
  unregisterPushSubscriptionSchema,
} from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { type DevicePlatform, deviceTokens } from '../db/schema';
import { APNS_PLATFORMS, type ApnsEnvironment, type ApnsPlatform } from '../lib/apns';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { parseInput } from '../lib/validate';
import { BaseService } from './base.service';
import { ContactService } from './contact.service';

const isApnsPlatform = (platform: string): platform is ApnsPlatform =>
  (APNS_PLATFORMS as readonly string[]).includes(platform);

export type WebPushDevice = {
  id: string;
  platform: 'web';
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type ApnsPushDevice = {
  id: string;
  platform: ApnsPlatform;
  deviceToken: string;
  /** The environment the device registered with, over its app's in the config. */
  environment?: ApnsEnvironment;
};

export type FcmPushDevice = {
  id: string;
  platform: 'android';
  deviceToken: string;
};

export type WnsPushDevice = {
  id: string;
  platform: 'windows';
  channelUri: string;
};

export type PushDevice = WebPushDevice | ApnsPushDevice | FcmPushDevice | WnsPushDevice;

export const isApnsDevice = (device: PushDevice): device is ApnsPushDevice =>
  isApnsPlatform(device.platform);

type StoredMeta = {
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
  environment?: ApnsEnvironment;
};

const storedDevice = (
  request: z.output<typeof registerPushSubscriptionSchema>,
): { platform: DevicePlatform; token: string; meta: StoredMeta } => {
  if ('subscription' in request) {
    return {
      platform: 'web',
      token: request.subscription.endpoint,
      meta: { keys: request.subscription.keys, userAgent: request.userAgent },
    };
  }
  // FCM tokens and WNS channel URIs are case-sensitive, so they are kept as they came.
  if (request.platform === 'android' || request.platform === 'windows') {
    return {
      platform: request.platform,
      token: request.deviceToken,
      meta: { userAgent: request.userAgent },
    };
  }
  // APNs tokens are case-insensitive hex.
  return {
    platform: request.platform,
    token: request.deviceToken.toLowerCase(),
    meta: { userAgent: request.userAgent, environment: request.environment },
  };
};

export class PushSubscriptionService extends BaseService {
  protected static override name = 'push';

  // The endpoint (web) or device token (apps) is the row's identity: it names
  // one installation, which one recipient owns at a time. Registering a token
  // that exists hands it to the new recipient, so a user who signed out
  // without unregistering stops getting pushes on the next user's device.
  static register = async (rawRequest: unknown): Promise<{ id: string }> => {
    const request = parseInput(registerPushSubscriptionSchema, rawRequest);
    await ContactService.upsertFromRecipient(request.recipient);

    const device = storedDevice(request);

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
    // an FCM token or a WNS channel URI as it was registered.
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
      if (row.platform === 'android') {
        return [{ id: row.id, platform: 'android', deviceToken: row.token }];
      }
      if (row.platform === 'windows') {
        return [{ id: row.id, platform: 'windows', channelUri: row.token }];
      }
      const meta = parseJson<StoredMeta>(row.meta, {});
      if (isApnsPlatform(row.platform)) {
        return [
          {
            id: row.id,
            platform: row.platform,
            deviceToken: row.token,
            environment: meta.environment,
          },
        ];
      }
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
    for (const platform of APNS_PLATFORMS) if (push?.apns?.[platform]) platforms.push(platform);
    if (push?.fcm) platforms.push('android');
    if (push?.wns) platforms.push('windows');
    return platforms;
  };

  // A device whose platform has no credentials, such as a Mac when APNs only names the iOS
  // app, can't be reached, so it does not count.
  static hasReachableDevice = (recipientId: string): Promise<boolean> =>
    PushSubscriptionService.client.deviceTokens.exists({
      where: { recipientId, platform: { in: PushSubscriptionService.configuredPlatforms() } },
    });

  static removeByIds = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await PushSubscriptionService.db.delete(deviceTokens).where(inArray(deviceTokens.id, ids));
  };
}
