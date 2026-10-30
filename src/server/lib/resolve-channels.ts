import type { Channel } from '../../contract/contract';
import { CHANNELS } from '../../contract/contract';
import type { SkipReason } from '../db/schema';
import { passesGate } from '../services/adapters/registry';
import type { ContactSnapshot } from '../services/contact.service';

export type ChannelResolution = {
  channel: Channel;
  skipReason?: SkipReason;
};

export type ResolveInput = {
  requestedChannels?: Channel[];
  transactional: boolean;
  type: string;
  enabledChannels: Channel[];
  preferences?: {
    channels: Partial<Record<Channel, boolean>>;
    mutedTypes: string[];
  } | null;
  contact: ContactSnapshot;
  capabilities: Partial<Record<Channel, boolean>>;
  templatesByChannel: Partial<Record<Channel, boolean>>;
};

const matchesPattern = (type: string, pattern: string): boolean =>
  pattern.endsWith('*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern;

// An entry may target a single channel with a `channel:` prefix
// ('push:reminder.*'); template types can never contain ':', so the prefix is
// unambiguous. Entries without a channel prefix mute the type on every channel.
const matchesMutedType = (channel: Channel, type: string, mutedTypes: string[]): boolean =>
  mutedTypes.some((entry) => {
    const at = entry.indexOf(':');
    if (at > 0 && (CHANNELS as readonly string[]).includes(entry.slice(0, at))) {
      return entry.slice(0, at) === channel && matchesPattern(type, entry.slice(at + 1));
    }
    return matchesPattern(type, entry);
  });

export const resolveChannels = (input: ResolveInput): ChannelResolution[] => {
  const requested = input.requestedChannels ?? input.enabledChannels;
  const usePreferences = !input.transactional;

  return requested.map((channel): ChannelResolution => {
    if (!input.enabledChannels.includes(channel)) {
      return { channel, skipReason: 'channel_not_configured' };
    }

    // A channel the type's template doesn't use is skipped for that reason alone: whether the
    // contact muted it or lacks an address for it says nothing about this send.
    if (!input.templatesByChannel[channel]) {
      return { channel, skipReason: 'no_template' };
    }

    if (usePreferences && input.preferences) {
      if (input.preferences.channels[channel] === false) {
        return { channel, skipReason: 'muted_by_preferences' };
      }
      if (matchesMutedType(channel, input.type, input.preferences.mutedTypes)) {
        return { channel, skipReason: 'muted_by_preferences' };
      }
    }

    const gateSkip = passesGate(channel, input.contact, input.capabilities);
    if (gateSkip) return { channel, skipReason: gateSkip };

    return { channel };
  });
};
