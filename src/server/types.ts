// `kind` lets a host that runs several queues tell chaski's batches apart.
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

export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
    attachments?: EmailAttachment[];
  }): Promise<{ messageId: string }>;
}
