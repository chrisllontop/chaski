import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Channel, ChannelsOverview } from './types';

export const useChannelsOverview = () =>
  useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<ChannelsOverview>('channels'),
    staleTime: Number.POSITIVE_INFINITY,
  });

/** The channels whose saved settings stopped working: they stay on, and their deliveries fail. */
export const failingChannels = (overview: ChannelsOverview): Channel[] => {
  const [email, inApp, push] = overview.channels;
  const failing: Channel[] = [];
  if (email.settings?.problem) failing.push('email');
  if (inApp.settings?.problem) failing.push('in_app');
  if (Object.values(push.providers).some((provider) => provider?.problem)) failing.push('push');
  return failing;
};
