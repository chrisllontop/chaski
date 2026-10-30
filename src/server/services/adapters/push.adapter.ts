import type { PushPayload } from '../../../contract/contract';
import { ChaskiError, isChaskiError } from '../../../contract/errors';
import type { ResolvedPush } from '../../config';
import { feedStub } from '../../durable/feed';
import {
  type ApnsApp,
  type ApnsCredentials,
  buildApnsRequest,
  clearApnsAuthToken,
  getApnsAuthToken,
} from '../../lib/apns';
import { DeliveryError } from '../../lib/errors';
import {
  buildFcmRequest,
  clearFcmAccessToken,
  type FcmCredentials,
  type FcmError,
  getFcmAccessToken,
  readFcmError,
} from '../../lib/fcm';
import { parseJson } from '../../lib/json';
import { renderTemplate } from '../../lib/render';
import { encryptPushPayload, MAX_PAYLOAD_BYTES, vapidAuthorization } from '../../lib/web-push';
import {
  buildToast,
  buildWnsRequest,
  clearWnsAccessToken,
  getWnsAccessToken,
  MAX_TOAST_BYTES,
  type WnsCredentials,
} from '../../lib/wns';
import { BaseService } from '../base.service';
import type { ContactSnapshot } from '../contact.service';
import {
  type ApnsPushDevice,
  type FcmPushDevice,
  isApnsDevice,
  PushSubscriptionService,
  type WebPushDevice,
  type WnsPushDevice,
} from '../push-subscription.service';
import { TemplateService } from '../template.service';
import type { AdapterContext, AdapterResult } from './types';

// 'expired' forgets a device quietly: it was uninstalled or its token rotated. A refused device
// is forgotten too, but the refusal can point at the config, so it is reported.
type PushOutcome = 'delivered' | 'expired' | { refused: string };

// What Apple's 400 reasons for a token that will never work again say about the cause. A token
// of another environment or another app reads the same as a broken one, so each names the
// setting to check before the device registers again.
const APNS_REFUSALS: Record<string, (device: ApnsPushDevice, app: ApnsApp) => string> = {
  BadDeviceToken: (device, app) =>
    `APNs refused the ${device.platform} device ${device.id} in ` +
    `${device.environment ?? app.environment} (BadDeviceToken): a development build's token ` +
    "only works in sandbox, so register it with environment: 'sandbox'",
  DeviceTokenNotForTopic: (device, app) =>
    `APNs refused the ${device.platform} device ${device.id} for ${app.bundleId} ` +
    `(DeviceTokenNotForTopic): the token belongs to another app; check ` +
    `channels.push.apns.${device.platform}.bundleId and the platform the app registers with`,
};

// What a failed FCM send means for the device and for the access token:
// 'expired' forgets the device, 'renew' drops the cached access token and
// retries, 'retry' only retries.
type FcmVerdict = 'expired' | 'renew' | 'retry';

// Only FCM's own codes condemn a device: a 403 PERMISSION_DENIED or a 404
// NOT_FOUND without one is the service account or the project, not the token,
// and so is SENDER_ID_MISMATCH, a service account of another Firebase project.
// Firebase reads INVALID_ARGUMENT as a dead token only when the payload is
// valid; Chaski builds a fixed payload and checks its size before sending, so
// the token is to blame unless the 400 names another field.
const classifyFcmError = (status: number, error: FcmError): FcmVerdict => {
  if (error.errorCode === 'UNREGISTERED') return 'expired';
  if (error.errorCode === 'INVALID_ARGUMENT' && (!error.field || error.field === 'message.token')) {
    return 'expired';
  }
  if (status === 401) return 'renew';
  return 'retry';
};

const sendWebPush = async (
  vapid: NonNullable<ResolvedPush['vapid']>,
  device: WebPushDevice,
  payload: Uint8Array,
): Promise<PushOutcome> => {
  const response = await fetch(device.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(device.endpoint, vapid),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '3600',
      urgency: 'high',
    },
    body: await encryptPushPayload(payload, device.keys),
  });
  if (response.status === 404 || response.status === 410) return 'expired';
  if (!response.ok) throw new Error(`the push service answered ${response.status}`);
  return 'delivered';
};

const sendApns = async (
  creds: ApnsCredentials,
  app: ApnsApp,
  authToken: string,
  device: ApnsPushDevice,
  payload: PushPayload,
): Promise<PushOutcome> => {
  const request = buildApnsRequest({
    authToken,
    deviceToken: device.deviceToken,
    topic: app.bundleId,
    environment: device.environment ?? app.environment,
    payload: {
      aps: {
        alert: { title: payload.title, body: payload.body },
        ...(payload.silent ? {} : { sound: 'default' }),
      },
      ...payload.data,
      ...(payload.href ? { href: payload.href } : {}),
      ...(payload.tag ? { tag: payload.tag } : {}),
    },
    collapseId: payload.tag,
  });
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  if (response.ok) return 'delivered';

  const reason = ((await response.json().catch(() => ({}))) as { reason?: string }).reason;
  if (response.status === 410) return 'expired';
  if (response.status === 400 && reason === 'ExpiredToken') return 'expired';
  const refusal = response.status === 400 && reason ? APNS_REFUSALS[reason] : undefined;
  if (refusal) return { refused: refusal(device, app) };
  if (response.status === 403 && reason === 'ExpiredProviderToken') clearApnsAuthToken(creds);
  throw new Error(`APNs answered ${response.status}${reason ? ` (${reason})` : ''}`);
};

const sendFcm = async (
  creds: FcmCredentials,
  accessToken: string,
  device: FcmPushDevice,
  payload: PushPayload,
): Promise<PushOutcome> => {
  const request = buildFcmRequest({
    accessToken,
    projectId: creds.projectId,
    deviceToken: device.deviceToken,
    notification: { title: payload.title, body: payload.body },
    // FCM only carries strings in data.
    data: {
      ...payload.data,
      ...(payload.href ? { href: payload.href } : {}),
      ...(payload.tag ? { tag: payload.tag } : {}),
    },
    tag: payload.tag,
  });
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  if (response.ok) return 'delivered';

  const error = await readFcmError(response);
  const verdict = classifyFcmError(response.status, error);
  if (verdict === 'expired') return 'expired';
  if (verdict === 'renew') clearFcmAccessToken(creds);
  const code = error.errorCode ?? error.status;
  throw new Error(`FCM answered ${response.status}${code ? ` (${code})` : ''}`);
};

// A 200 only says WNS took the request; X-WNS-Status says whether it passed the toast on.
const WNS_NOT_DELIVERED = new Set(['dropped', 'channelthrottled']);

const sendWns = async (
  creds: WnsCredentials,
  accessToken: string,
  device: WnsPushDevice,
  toast: string,
): Promise<PushOutcome> => {
  const request = buildWnsRequest({ accessToken, channelUri: device.channelUri, toast });
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  const status = response.headers.get('x-wns-status');
  if (response.ok && !(status && WNS_NOT_DELIVERED.has(status))) return 'delivered';
  // 404 is a channel WNS doesn't know, 410 one that expired: the app asks for a new one.
  if (response.status === 404 || response.status === 410) return 'expired';
  if (response.status === 401) clearWnsAccessToken(creds);
  const detail = response.headers.get('x-wns-error-description') ?? status;
  throw new Error(`WNS answered ${response.status}${detail ? ` (${detail})` : ''}`);
};

export class PushAdapter extends BaseService {
  protected static override name = 'push';

  // A device whose app holds its feed open gets the item there and shows it itself, so a push
  // would show the same event twice. That holds only when the notification goes to the feed at
  // all; a feed that doesn't answer leaves every device to push.
  private static devicesInFeed = async (
    notificationId: string,
    recipientId: string,
  ): Promise<Set<string>> => {
    if (!PushAdapter.bindings.feed) return new Set();
    const inApp = await PushAdapter.client.deliveries.findFirst({
      where: { notificationId, channel: 'in_app' },
    });
    if (inApp?.status !== 'pending' && inApp?.status !== 'sent') return new Set();
    try {
      return new Set(await feedStub(recipientId).openDevices());
    } catch (error) {
      PushAdapter.log.warn('feed did not say which devices are open', {
        notificationId,
        err: error instanceof Error ? error.message : String(error),
      });
      return new Set();
    }
  };

  static deliver = async (ctx: AdapterContext): Promise<AdapterResult> => {
    const { notification } = ctx;
    const config = PushAdapter.config;
    const push = config.channels.push;
    if (!push) {
      throw new DeliveryError('channel_not_configured', 'the push channel is not configured', {
        permanent: true,
      });
    }
    const content = await TemplateService.findActiveContent(notification.type, 'push');
    if (!content) {
      throw new DeliveryError(
        'no_template',
        `no active push template for type '${notification.type}'`,
        { permanent: true },
      );
    }

    const snapshot = parseJson<ContactSnapshot>(notification.contactSnapshot, {});
    const data = {
      ...parseJson<Record<string, unknown>>(notification.payload, {}),
      recipient: snapshot,
    };
    // Same layout as in_app templates: title in subject, message in body and
    // the link the notification opens in textBody.
    const [title, body, href] = await Promise.all([
      renderTemplate(content.subject ?? '', data),
      renderTemplate(content.body, data),
      content.textBody ? renderTemplate(content.textBody, data) : Promise.resolve(undefined),
    ]);

    const platforms = PushSubscriptionService.configuredPlatforms();
    const registered = (
      await PushSubscriptionService.listForRecipient(notification.recipientId)
    ).filter((device) => platforms.includes(device.platform));
    if (registered.length === 0) {
      throw new DeliveryError('no_device_tokens', 'the recipient has no device push can reach', {
        permanent: true,
      });
    }
    const inFeed = await PushAdapter.devicesInFeed(notification.id, notification.recipientId);
    const devices = registered.filter((device) => !inFeed.has(device.id));
    const viaFeed = registered.length - devices.length;
    const feedNote = viaFeed > 0 ? ` feed:${viaFeed}` : '';
    if (devices.length === 0) return { providerMessageId: `push:0/0${feedNote}` };

    const sendData = parseJson<Record<string, string> | null>(notification.data, null);
    const message: PushPayload = {
      title,
      body,
      href: href || undefined,
      tag: notification.pushCollapseId ?? notification.id,
      ...(notification.pushSilent ? { silent: true } : {}),
      ...(sendData ? { data: sendData } : {}),
    };
    const webPayload = new TextEncoder().encode(JSON.stringify(message));
    if (webPayload.length > MAX_PAYLOAD_BYTES) {
      throw new DeliveryError(
        'payload_too_large',
        `the rendered push is ${webPayload.length} bytes; web push carries at most ${MAX_PAYLOAD_BYTES}`,
        { permanent: true },
      );
    }
    const { vapid, apns, fcm, wns } = push;
    const windows = wns && devices.some((device) => device.platform === 'windows');
    const toast = windows
      ? buildToast({
          title,
          body,
          arguments: {
            ...message.data,
            ...(message.href ? { href: message.href } : {}),
            ...(message.tag ? { tag: message.tag } : {}),
          },
          silent: message.silent,
        })
      : null;
    const toastBytes = toast ? new TextEncoder().encode(toast).length : 0;
    if (toastBytes > MAX_TOAST_BYTES) {
      throw new DeliveryError(
        'payload_too_large',
        `the rendered toast is ${toastBytes} bytes; WNS carries at most ${MAX_TOAST_BYTES}`,
        { permanent: true },
      );
    }
    // One provider token signs the whole fan-out, for every app of the team.
    const apnsToken = apns && devices.some(isApnsDevice) ? await getApnsAuthToken(apns) : null;
    // The FCM access token takes a request to Google, so it is not awaited
    // here: a failed exchange fails the Android devices and no other.
    const fcmToken =
      fcm && devices.some((device) => device.platform === 'android')
        ? getFcmAccessToken(fcm)
        : null;
    // Like FCM's, the WNS access token takes a request, so a failed exchange fails only Windows.
    const wnsToken = windows ? getWnsAccessToken(wns) : null;
    const broken = PushSubscriptionService.brokenPlatforms();
    const results = await Promise.allSettled(
      devices.map((device) => {
        const problem = broken[device.platform];
        if (problem) return Promise.reject(new ChaskiError('config', problem));
        if (device.platform === 'web' && vapid) return sendWebPush(vapid, device, webPayload);
        if (isApnsDevice(device)) {
          const app = apns?.[device.platform];
          if (apns && app && apnsToken) return sendApns(apns, app, apnsToken, device, message);
        }
        if (device.platform === 'android' && fcm && fcmToken) {
          return fcmToken.then((token) => sendFcm(fcm, token, device, message));
        }
        if (device.platform === 'windows' && wns && wnsToken && toast) {
          return wnsToken.then((token) => sendWns(wns, token, device, toast));
        }
        return Promise.reject(new Error(`no credentials for ${device.platform} push`));
      }),
    );

    const outcome = (i: number) => {
      const result = results[i];
      return result?.status === 'fulfilled' ? result.value : null;
    };
    const refusals = devices.flatMap((_, i) => {
      const value = outcome(i);
      return typeof value === 'object' && value !== null ? [value.refused] : [];
    });
    for (const refusal of refusals) {
      PushAdapter.log.warn('device refused', { deliveryId: ctx.delivery.id, refusal });
    }
    const droppedIds = devices
      .filter((_, i) => outcome(i) !== null && outcome(i) !== 'delivered')
      .map((d) => d.id);
    await PushSubscriptionService.removeByIds(droppedIds);

    const delivered = devices.filter((_, i) => outcome(i) === 'delivered').length;
    if (delivered > 0) {
      return { providerMessageId: `push:${delivered}/${devices.length}${feedNote}` };
    }
    if (droppedIds.length === devices.length) {
      throw new DeliveryError(
        'no_device_tokens',
        refusals.length > 0
          ? `every device of the recipient was dropped: ${refusals.join('; ')}`
          : 'every device of the recipient had expired',
        { permanent: true },
      );
    }
    const rejections = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    // Credentials someone has to fix fail the same way on every attempt, so nothing retries them.
    const misconfigured = (r: PromiseRejectedResult) =>
      isChaskiError(r.reason) && r.reason.code === 'config';
    const rejection = rejections[0];
    if (rejection && rejections.every(misconfigured)) throw rejection.reason;
    const reason =
      rejection?.reason instanceof Error ? rejection.reason.message : String(rejection?.reason);
    throw new DeliveryError('provider_error', reason, { permanent: false });
  };
}
