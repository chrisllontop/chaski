import type { Channel } from '../../../contract/contract';
import type { SkipReason } from '../../db/schema';
import type { ContactSnapshot } from '../contact.service';
import { PushSubscriptionService } from '../push-subscription.service';
import { EmailAdapter } from './email.adapter';
import { InAppAdapter } from './inapp.adapter';
import { PushAdapter } from './push.adapter';
import type { AdapterContext, AdapterResult } from './types';

// A channel's recipient prerequisite, declared as data so resolveChannels
// stays generic: either a contact field must be present, or an async-loaded
// capability (e.g. registered device tokens) must hold.
export type ChannelGate =
  | { kind: 'contact'; field: 'email' | 'phoneE164'; skipReason: SkipReason }
  | { kind: 'capability'; skipReason: SkipReason }
  | null;

export type ChannelDefinition = {
  gate: ChannelGate;
  loadCapability?: (recipientId: string) => Promise<boolean>;
  deliver: (ctx: AdapterContext) => Promise<AdapterResult>;
};

export const CHANNEL_DEFS: Record<Channel, ChannelDefinition> = {
  email: {
    gate: { kind: 'contact', field: 'email', skipReason: 'missing_email' },
    deliver: EmailAdapter.deliver,
  },
  in_app: { gate: null, deliver: InAppAdapter.deliver },
  push: {
    gate: { kind: 'capability', skipReason: 'no_device_tokens' },
    loadCapability: PushSubscriptionService.hasReachableDevice,
    deliver: PushAdapter.deliver,
  },
};

export const passesGate = (
  channel: Channel,
  contact: ContactSnapshot,
  capabilities: Partial<Record<Channel, boolean>>,
): SkipReason | null => {
  const gate = CHANNEL_DEFS[channel]?.gate;
  if (!gate) return null;
  if (gate.kind === 'contact') return contact[gate.field] ? null : gate.skipReason;
  return capabilities[channel] ? null : gate.skipReason;
};

// Resolves the capability of each requested channel that declares one, so
// dispatch stays channel-agnostic.
export const loadCapabilities = async (
  recipientId: string,
  requested: Channel[],
): Promise<Partial<Record<Channel, boolean>>> => {
  const entries = await Promise.all(
    requested.flatMap((channel) => {
      const load = CHANNEL_DEFS[channel]?.loadCapability;
      return load ? [load(recipientId).then((capable) => [channel, capable] as const)] : [];
    }),
  );
  return Object.fromEntries(entries);
};
