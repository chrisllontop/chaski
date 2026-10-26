import type { deliveries, notifications } from '../../db/schema';

export type DeliveryRow = typeof deliveries.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;

export type AdapterContext = {
  delivery: DeliveryRow;
  notification: NotificationRow;
};

export type AdapterResult = {
  providerMessageId?: string;
};
