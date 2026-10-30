import { feedStub } from '../../durable/feed';
import { DeliveryError } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { parseJson } from '../../lib/json';
import { renderTemplate } from '../../lib/render';
import { reportError } from '../../lib/report-error';
import { BaseService } from '../base.service';
import type { ContactSnapshot } from '../contact.service';
import { toFeedItem } from '../feed.service';
import { TemplateService } from '../template.service';
import type { AdapterContext, AdapterResult } from './types';

export class InAppAdapter extends BaseService {
  protected static override name = 'in_app';

  static deliver = async (ctx: AdapterContext): Promise<AdapterResult> => {
    const { notification } = ctx;
    const content = await TemplateService.findActiveContent(notification.type, 'in_app');
    if (!content) {
      throw new DeliveryError(
        'no_template',
        `no active in_app template for type '${notification.type}'`,
        { permanent: true },
      );
    }

    const snapshot = parseJson<ContactSnapshot>(notification.contactSnapshot, {});
    const data = {
      ...parseJson<Record<string, unknown>>(notification.payload, {}),
      recipient: snapshot,
    };

    // An in_app template keeps the title in subject, the message in body and
    // the link the item opens in textBody.
    const [title, body, href] = await Promise.all([
      renderTemplate(content.subject ?? '', data),
      renderTemplate(content.body, data),
      content.textBody ? renderTemplate(content.textBody, data) : Promise.resolve(undefined),
    ]);

    const item = await InAppAdapter.client.feedItems.create({
      data: {
        id: newId('f'),
        recipientId: notification.recipientId,
        notificationId: notification.id,
        title,
        body,
        data: href ? JSON.stringify({ href }) : null,
      },
    });

    // The item is already stored and the feed API serves it; a lost realtime
    // signal must not fail the delivery or send a duplicate on retry.
    try {
      await feedStub(notification.recipientId).publish({
        type: 'feed_item.created',
        item: toFeedItem({
          ...item,
          type: notification.type,
          notificationData: notification.data,
        }),
      });
    } catch (error) {
      reportError(error, { source: 'feed', deliveryId: ctx.delivery.id, channel: 'in_app' });
      InAppAdapter.log.error('feed signal failed', error, { feedItemId: item.id });
    }

    return { providerMessageId: item.id };
  };
}
