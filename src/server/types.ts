// `kind` lets a host that runs several queues tell chaski's batches apart.
export interface DeliveryMessage {
  kind: 'chaski.delivery';
  deliveryId: string;
  notificationId: string;
  channel: string;
  type: string;
  recipientId: string;
}
