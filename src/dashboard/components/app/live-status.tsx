import { Link } from '@tanstack/react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { useChannelsOverview } from '~/lib/channels';
import { useLiveStatus } from '~/lib/events';
import { CHANNEL_LABELS } from '~/lib/format';
import { Pill } from './pill';

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
  const paused = channels.data.channels.filter((channel) => channel.paused);
  return (
    <div className="flex items-center gap-2">
      {paused.map(({ channel }) => (
        <Tooltip key={channel}>
          <TooltipTrigger asChild>
            <Link to="/channels">
              <Pill tone="warning">{CHANNEL_LABELS[channel]} paused</Pill>
            </Link>
          </TooltipTrigger>
          <TooltipContent>Its deliveries wait as held until someone resumes it.</TooltipContent>
        </Tooltip>
      ))}
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
