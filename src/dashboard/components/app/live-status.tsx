import { Link } from '@tanstack/react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { failingChannels, useChannelsOverview } from '~/lib/channels';
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

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Where this dashboard runs, whether it follows changes live, and whether sends reach anyone. */
export const LiveStatus = () => {
  const status = useLiveStatus();
  const channels = useChannelsOverview();
  if (!channels.data) return null;
  const live = LIVE[status];
  const { environment } = channels.data;
  const paused = channels.data.channels.filter((channel) => channel.paused);
  const failing = failingChannels(channels.data);
  return (
    <div className="flex items-center gap-2">
      {environment ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Pill tone="info">{capitalize(environment)}</Pill>
            </span>
          </TooltipTrigger>
          <TooltipContent>Where this Worker runs, as CHASKI_ENVIRONMENT names it.</TooltipContent>
        </Tooltip>
      ) : null}
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
      {failing.map((channel) => (
        <Tooltip key={channel}>
          <TooltipTrigger asChild>
            <Link to="/channels">
              <Pill tone="danger">{CHANNEL_LABELS[channel]} failing</Pill>
            </Link>
          </TooltipTrigger>
          <TooltipContent>
            Its saved settings stopped working, so its deliveries fail.
          </TooltipContent>
        </Tooltip>
      ))}
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
            : 'Add the CHASKI_EVENTS binding to see changes as they happen.'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
};
