import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ChannelsOverview } from './types';

export const useChannelsOverview = () =>
  useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<ChannelsOverview>('channels'),
    staleTime: Number.POSITIVE_INFINITY,
  });
