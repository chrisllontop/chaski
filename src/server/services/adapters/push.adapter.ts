import type { PushPayload } from '../../../contract/contract';
import type { ResolvedPush } from '../../config';
import {
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
import { BaseService } from '../base.service';
import type { ContactSnapshot } from '../contact.service';
import type { ApnsPushDevice, FcmPushDevice, WebPushDevice } from '../push-subscription.service';
import { PushSubscriptionService } from '../push-subscription.service';
import { TemplateService } from '../template.service';
import type { AdapterContext, AdapterResult } from './types';

type PushOutcome = 'delivered' | 'expired';

// Apple answers 400 with these for tokens that will never work again; with
// 410 Unregistered they are the signals to forget a device.
const APNS_PRUNE_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'ExpiredToken']);

// What a failed FCM send means for the device and for the access token:
// 'expired' forgets the device, 'renew' drops the cached access token and
// retries, 'retry' only retries.
type FcmVerdict = 'expired' | 'renew' | 'retry';

// Only FCM's own codes condemn a device: a 403 PERMISSION_DENIED or a 404
// NOT_FOUND without one is the service account or the project, not the token.
// Firebase reads INVALID_ARGUMENT as a dead token only when the payload is
// valid; Chaski builds a fixed payload and checks its size before sending, so
// the token is to blame unless the 400 names another field.
const classifyFcmError = (status: number, error: FcmError): FcmVerdict => {
  if (error.errorCode === 'UNREGISTERED' || error.errorCode === 'SENDER_ID_MISMATCH') {
    return 'expired';
  }
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
  authToken: string,
  device: ApnsPushDevice,
  payload: PushPayload,
): Promise<PushOutcome> => {
  const request = buildApnsRequest({
    authToken,
    deviceToken: device.deviceToken,
    bundleId: creds.bundleId,
    environment: creds.environment,
    payload: {
      aps: { alert: { title: payload.title, body: payload.body }, sound: 'default' },
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
  if (response.status === 400 && reason && APNS_PRUNE_REASONS.has(reason)) return 'expired';
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

  const error = await readFcmError(response);
  const verdict = classifyFcmError(response.status, error);
  if (verdict === 'expired') return 'expired';
  if (verdict === 'renew') clearFcmAccessToken(creds);
  const code = error.errorCode ?? error.status;
  throw new Error(`FCM answered ${response.status}${code ? ` (${code})` : ''}`);
};

export class PushAdapter extends BaseService {
  protected static override name = 'push';

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
    const devices = (
      await PushSubscriptionService.listForRecipient(notification.recipientId)
    ).filter((device) => platforms.includes(device.platform));
    if (devices.length === 0) {
      throw new DeliveryError('no_device_tokens', 'the recipient has no device push can reach', {
        permanent: true,
      });
    }

    const message: PushPayload = { title, body, href: href || undefined, tag: notification.id };
    const webPayload = new TextEncoder().encode(JSON.stringify(message));
    if (webPayload.length > MAX_PAYLOAD_BYTES) {
      throw new DeliveryError(
        'payload_too_large',
        `the rendered push is ${webPayload.length} bytes; web push carries at most ${MAX_PAYLOAD_BYTES}`,
        { permanent: true },
      );
    }
    const { vapid, apns, fcm } = push;
    // One provider token signs the whole fan-out.
    const apnsToken =
      apns && devices.some((device) => device.platform === 'ios')
        ? await getApnsAuthToken(apns)
        : null;
    // The FCM access token takes a request to Google, so it is not awaited
    // here: a failed exchange fails the Android devices and no other.
    const fcmToken =
      fcm && devices.some((device) => device.platform === 'android')
        ? getFcmAccessToken(fcm)
        : null;
    const results = await Promise.allSettled(
      devices.map((device) => {
        if (device.platform === 'web' && vapid) return sendWebPush(vapid, device, webPayload);
        if (device.platform === 'ios' && apns && apnsToken) {
          return sendApns(apns, apnsToken, device, message);
        }
        if (device.platform === 'android' && fcm && fcmToken) {
          return fcmToken.then((token) => sendFcm(fcm, token, device, message));
        }
        return Promise.reject(new Error(`no credentials for ${device.platform} push`));
      }),
    );

    const outcome = (i: number) => {
      const result = results[i];
      return result?.status === 'fulfilled' ? result.value : null;
    };
    const expiredIds = devices.filter((_, i) => outcome(i) === 'expired').map((d) => d.id);
    await PushSubscriptionService.removeByIds(expiredIds);

    const delivered = devices.filter((_, i) => outcome(i) === 'delivered').length;
    if (delivered > 0) return { providerMessageId: `push:${delivered}/${devices.length}` };
    if (expiredIds.length === devices.length) {
      throw new DeliveryError('no_device_tokens', 'every device of the recipient had expired', {
        permanent: true,
      });
    }
    const rejection = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    const reason =
      rejection?.reason instanceof Error ? rejection.reason.message : String(rejection?.reason);
    throw new DeliveryError('provider_error', reason, { permanent: false });
  };
}
