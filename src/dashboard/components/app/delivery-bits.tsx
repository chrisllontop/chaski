import { Bell, CircleCheck, CircleMinus, CircleX, Loader, Mail, Smartphone } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { CHANNEL_LABELS } from '~/lib/format';
import type { Channel, DeliveryStatus } from '~/lib/types';

const STATUS: Record<
  DeliveryStatus,
  { label: string; icon: typeof CircleCheck; className: string }
> = {
  sent: { label: 'Sent', icon: CircleCheck, className: 'text-success' },
  pending: { label: 'Pending', icon: Loader, className: 'text-muted-foreground' },
  failed: { label: 'Failed', icon: CircleX, className: 'text-destructive' },
  dead: { label: 'Dead', icon: CircleX, className: 'text-destructive' },
  skipped: { label: 'Skipped', icon: CircleMinus, className: 'text-muted-foreground' },
};

export const STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS).map(([status, { label }]) => [status, label]),
) as Record<DeliveryStatus, string>;

export const StatusBadge = ({ status }: { status: DeliveryStatus }) => {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <Badge variant="outline" className="gap-1 px-1.5 text-muted-foreground">
      <Icon className={className} />
      {label}
    </Badge>
  );
};

export const CHANNEL_ICONS: Record<Channel, typeof Mail> = {
  email: Mail,
  in_app: Bell,
  push: Smartphone,
};

export const ChannelLabel = ({ channel }: { channel: Channel }) => {
  const Icon = CHANNEL_ICONS[channel];
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      {CHANNEL_LABELS[channel]}
    </span>
  );
};
