import { injectOpenPixel, openPixelUrl } from '../../lib/email-open';
import { DeliveryError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import type { EmailAttachment } from '../../types';
import type { StoredAttachment } from '../attachment.service';
import { AttachmentService } from '../attachment.service';
import { BaseService } from '../base.service';
import type { ContactSnapshot } from '../contact.service';
import { EmailSenderService, senderAddress } from '../email-sender.service';
import { TemplateService } from '../template.service';
import type { AdapterContext, AdapterResult } from './types';

type EmailOverrides = { fromName?: string; replyTo?: string };

export class EmailAdapter extends BaseService {
  protected static override name = 'email';

  static deliver = async (ctx: AdapterContext): Promise<AdapterResult> => {
    const config = EmailAdapter.config;
    const emailConfig = config.channels.email;
    if (!emailConfig) {
      throw new DeliveryError('channel_not_configured', 'the email channel is not configured', {
        permanent: true,
      });
    }
    const snapshot = parseJson<ContactSnapshot>(ctx.notification.contactSnapshot, {});
    if (!snapshot.email) {
      throw new DeliveryError('missing_email', 'contact snapshot has no email', {
        permanent: true,
      });
    }

    const overrides = parseJson<EmailOverrides>(ctx.notification.emailOverrides, {});
    const {
      subject,
      body: renderedHtml,
      textBody: text,
    } = await TemplateService.renderDelivery(ctx.content, ctx.notification, { html: true });

    // The pixel loads through the app's userRoutes(), since Access closes Chaski's own URL to
    // mail clients; without CHASKI_PUBLIC_URL there is nowhere for it to load from.
    const html = config.publicUrl
      ? injectOpenPixel(renderedHtml, openPixelUrl(config.publicUrl, ctx.delivery.id))
      : renderedHtml;

    const from = senderAddress(emailConfig.from, overrides.fromName ?? emailConfig.fromName);
    const replyTo = overrides.replyTo ?? emailConfig.replyTo;

    const stored = parseJson<StoredAttachment[]>(ctx.notification.attachments, []);
    const attachments = await EmailAdapter.loadAttachments(stored);

    const { messageId } = await EmailSenderService.send({
      to: snapshot.email,
      from,
      replyTo,
      subject,
      html,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    // A sent email can't be replayed, so nothing reads its attachments again.
    await AttachmentService.discard(stored, { deliveryId: ctx.delivery.id, channel: 'email' });
    return { providerMessageId: messageId };
  };

  private static loadAttachments = async (stored: StoredAttachment[]) => {
    const loaded: EmailAttachment[] = [];
    for (const attachment of stored) {
      const content = await AttachmentService.read(attachment);
      if (!content) {
        throw new DeliveryError('attachment_missing', `attachment ${attachment.r2Key} expired`, {
          permanent: true,
        });
      }
      loaded.push({
        filename: attachment.filename,
        type: attachment.contentType,
        content,
        disposition: attachment.disposition ?? 'attachment',
        contentId: attachment.contentId,
      });
    }
    return loaded;
  };
}
