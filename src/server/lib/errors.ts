// Thrown by channel adapters: a permanent error fails the delivery, anything
// else is retried with backoff until the queue's last attempt.
export class DeliveryError extends Error {
  readonly permanent: boolean;
  readonly errorCode: string;

  constructor(errorCode: string, message: string, opts: { permanent: boolean }) {
    super(message);
    this.name = 'DeliveryError';
    this.errorCode = errorCode;
    this.permanent = opts.permanent;
  }
}
