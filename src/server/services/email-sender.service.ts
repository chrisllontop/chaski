import { DeliveryError } from '../lib/errors';
import type { EmailAddress, SendEmailBinding } from '../types';
import { BaseService } from './base.service';

// A name pasted into the address string would reach the From header unquoted, and a comma in it
// ("Billing, Acme") splits one sender into two addresses.
export const senderAddress = (from: string, fromName?: string): string | EmailAddress =>
  fromName ? { email: from, name: fromName } : from;

// Email Service send() errors that cannot succeed on retry (structured `code`):
// developers.cloudflare.com/email-service/api/send-emails/workers-api/#error-codes
const PERMANENT_SEND_ERRORS = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_CONTENT_TOO_LARGE',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
  'E_SENDER_NOT_VERIFIED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_RECIPIENT_SUPPRESSED',
]);

export class EmailSenderService extends BaseService {
  protected static override name = 'email';

  // Mail only leaves through the CHASKI_EMAIL send_email binding.
  static send = async (
    message: Parameters<SendEmailBinding['send']>[0],
  ): Promise<{ messageId?: string }> => {
    const email = EmailSenderService.bindings.email;
    if (!email) {
      throw new DeliveryError('email_not_configured', 'the email channel is not configured', {
        permanent: true,
      });
    }
    try {
      return await email.send(message);
    } catch (error) {
      throw EmailSenderService.classifySendError(error);
    }
  };

  private static classifySendError = (error: unknown): DeliveryError => {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
    if (!code) return new DeliveryError('provider_error', message, { permanent: false });
    return new DeliveryError(code.replace(/^E_/, '').toLowerCase(), message, {
      permanent: PERMANENT_SEND_ERRORS.has(code),
    });
  };
}
