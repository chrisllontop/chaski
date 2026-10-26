import { Bell, Mail, Smartphone } from 'lucide-react';
import { CHANNEL_LABELS } from '~/lib/format';
import type { Channel, DeliveryStatus, Health } from '~/lib/types';
import { Pill, type Tone } from './pill';

const STATUS: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  sent: { label: 'Sent', tone: 'success' },
  pending: { label: 'Pending', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' },
  dead: { label: 'Dead', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export const STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS).map(([status, { label }]) => [status, label]),
) as Record<DeliveryStatus, string>;

export const StatusBadge = ({ status }: { status: DeliveryStatus }) => (
  <Pill tone={STATUS[status].tone} pulse={status === 'pending'}>
    {STATUS[status].label}
  </Pill>
);

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

const HEALTH: Record<Health, { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'success' },
  at_risk: { label: 'At risk', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'danger' },
  paused: { label: 'Paused', tone: 'neutral' },
};

export const HealthBadge = ({ health }: { health: Health }) => (
  <Pill tone={HEALTH[health].tone}>{HEALTH[health].label}</Pill>
);
