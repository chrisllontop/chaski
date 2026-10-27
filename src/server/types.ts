// `kind` lets a host that runs several queues tell Chaski's batches apart.
export interface DeliveryMessage {
  kind: 'chaski.delivery';
  deliveryId: string;
  notificationId: string;
  channel: string;
  type: string;
  recipientId: string;
}

// Mirrors the Email Service Workers API `Attachment` interface; the MIME type field is `type`.
export interface EmailAttachment {
  filename: string;
  type: string;
  content: string | ArrayBuffer;
  disposition: 'attachment' | 'inline';
  contentId?: string;
}

// The address shape of the Email Service Workers API: a display name travels
// next to the address, never inside the string, so the provider quotes it.
export type EmailAddress = { email: string; name: string };

export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string | EmailAddress;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
    attachments?: EmailAttachment[];
  }): Promise<{ messageId: string }>;
}

export type ScheduleParams = {
  scheduledId: string;
};
