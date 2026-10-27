import { injectOpenPixel, openPixelUrl } from '../../lib/email-open';
import { DeliveryError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { renderHtml, renderTemplate } from '../../lib/render';
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

    const content = await TemplateService.findActiveContent(ctx.notification.type, 'email');
    if (!content) {
      throw new DeliveryError(
        'no_template',
        `no active email template for type '${ctx.notification.type}'`,
        { permanent: true },
      );
    }

    const payload = parseJson<Record<string, unknown>>(ctx.notification.payload, {});
    const data = { ...payload, recipient: snapshot };
    const overrides = parseJson<EmailOverrides>(ctx.notification.emailOverrides, {});

    const [subject, renderedHtml, text] = await Promise.all([
      renderTemplate(content.subject ?? '', data),
      renderHtml(content.body, data),
      content.textBody ? renderTemplate(content.textBody, data) : Promise.resolve(undefined),
    ]);

    // The consumer has no request to derive an origin from, so the pixel URL
    // comes from the publicUrl the host declares.
    const html = injectOpenPixel(renderedHtml, openPixelUrl(config.publicUrl, ctx.delivery.id));

    const from = senderAddress(emailConfig.from, overrides.fromName ?? emailConfig.fromName);
    const replyTo = overrides.replyTo ?? emailConfig.replyTo;

    const attachments = await EmailAdapter.loadAttachments(
      parseJson<StoredAttachment[]>(ctx.notification.attachments, []),
    );

    const { messageId } = await EmailSenderService.send({
      to: snapshot.email,
      from,
      replyTo,
      subject,
      html,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
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
