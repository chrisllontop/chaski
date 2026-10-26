import { useQuery } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { api } from '~/lib/api';
import { useLiveStatus } from '~/lib/events';
import type { ChannelsOverview } from '~/lib/types';
import { Pill } from './pill';

export const useChannelsOverview = () =>
  useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<ChannelsOverview>('channels'),
    staleTime: Number.POSITIVE_INFINITY,
  });

const LIVE = {
  live: { label: 'Live', tone: 'success', hint: 'Changes show up here as they happen.' },
  connecting: { label: 'Connecting…', tone: 'neutral', hint: 'Opening the live connection.' },
  reconnecting: {
    label: 'Reconnecting…',
    tone: 'warning',
    hint: 'The live connection dropped. Pages still load fresh data when you open them.',
  },
} as const;

/** Whether the dashboard follows changes live, and whether sends reach anyone. */
export const LiveStatus = () => {
  const status = useLiveStatus();
  const channels = useChannelsOverview();
  if (!channels.data) return null;
  const live = LIVE[status];
  return (
    <div className="flex items-center gap-2">
      {channels.data.dryRun ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Pill tone="warning">Dry run</Pill>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Email and push render and record, but never reach a provider.
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            {channels.data.realtime ? (
              <Pill tone={live.tone} pulse={status !== 'live'}>
                {live.label}
              </Pill>
            ) : (
              <Pill tone="neutral">Live updates off</Pill>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {channels.data.realtime
            ? live.hint
            : 'Add bindings.events to your Chaski config to see changes as they happen.'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
};
