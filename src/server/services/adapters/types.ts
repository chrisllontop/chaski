import type { deliveries, notifications } from '../../db/schema';
import type { ActiveChannelContent } from '../template.service';

export type DeliveryRow = typeof deliveries.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;

export type AdapterContext = {
  delivery: DeliveryRow;
  notification: NotificationRow;
  /** The channel's content in the language the delivery resolved to. */
  content: ActiveChannelContent;
};

export type AdapterResult = {
  providerMessageId?: string;
};
