import { feedStub } from '../../durable/feed';
import { newId } from '../../lib/ids';
import { BaseService } from '../base.service';
import { toFeedItem } from '../feed.service';
import { TemplateService } from '../template.service';
import type { AdapterContext, AdapterResult } from './types';

export class InAppAdapter extends BaseService {
  protected static override name = 'in_app';

  static deliver = async (ctx: AdapterContext): Promise<AdapterResult> => {
    const { notification } = ctx;
    // An in_app template keeps the title in subject, the message in body and
    // the link the item opens in textBody.
    const {
      subject: title,
      body,
      textBody: href,
    } = await TemplateService.renderDelivery(ctx.content, notification, { html: false });

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
      InAppAdapter.log.error('feed signal failed', error, { feedItemId: item.id });
    }

    return { providerMessageId: item.id };
  };
}
