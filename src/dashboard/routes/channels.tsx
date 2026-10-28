import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bell, Mail, Pause, Play, Smartphone } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Panel } from '~/components/app/panel';
import { Pill } from '~/components/app/pill';
import { SiteHeader } from '~/components/app/site-header';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { ApiError, api, query } from '~/lib/api';
import { useChannelsOverview } from '~/lib/channels';
import { CHANNEL_LABELS, formatDateTime, formatNumber, formatRelative } from '~/lib/format';
import type { Channel, ChannelPause } from '~/lib/types';

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5 text-[13px]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-all">
      {children ?? <span className="text-muted-foreground">–</span>}
    </dd>
  </div>
);

const SetupHint = ({ configKey }: { configKey: string }) => (
  <p className="px-4 py-3 text-muted-foreground text-sm">
    Add <code className="font-mono text-foreground text-xs">{configKey}</code> to the config your
    Worker passes to <code className="font-mono text-foreground text-xs">createChaski()</code>.
  </p>
);

const ChannelPanel = ({
  icon: Icon,
  title,
  description,
  state,
  actions = null,
  children,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  state: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <Panel className="flex flex-col">
    <header className="flex items-start gap-3 border-b px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-medium text-sm leading-6">{title}</h2>
        <p className="text-pretty text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {state}
        {actions}
      </div>
    </header>
    <dl className="flex-1 divide-y">{children}</dl>
  </Panel>
);

const stateOf = (on: boolean, paused: ChannelPause | null) => {
  if (!on) return <Pill tone="neutral">Not configured</Pill>;
  return paused ? <Pill tone="warning">Paused</Pill> : <Pill tone="success">On</Pill>;
};

// What a pause stops, said per channel so the dialog names what the reader is about to hold.
const HOLDS: Record<Channel, string> = {
  email: 'Every email waits as held, password resets included',
  in_app: 'Every in-app notification waits as held, out of each contact’s feed',
  push: 'Every push notification waits as held',
};

const PausedRow = ({ paused }: { paused: ChannelPause }) => (
  <Row label="Paused by">
    {paused.pausedBy.name ?? paused.pausedBy.id} ·{' '}
    <time dateTime={paused.pausedAt} title={formatDateTime(paused.pausedAt)}>
      {formatRelative(paused.pausedAt)}
    </time>
  </Row>
);

const PauseButton = ({
  channel,
  paused,
  canPause,
  onPause,
  onResume,
}: {
  channel: Channel;
  paused: boolean;
  canPause: boolean;
  onPause: (channel: Channel) => void;
  onResume: (channel: Channel) => void;
}) => {
  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={!canPause}
      onClick={() => (paused ? onResume(channel) : onPause(channel))}
    >
      {paused ? <Play /> : <Pause />} {paused ? 'Resume' : 'Pause'}
    </Button>
  );
  if (canPause) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>Your Chaski setup doesn’t let you pause channels.</TooltipContent>
    </Tooltip>
  );
};

/** Resuming asks what to do with what the pause held: send it now, or keep it for review. */
const ResumeDialog = ({
  channel,
  open,
  onClose,
}: {
  channel: Channel;
  open: boolean;
  onClose: () => void;
}) => {
  const client = useQueryClient();
  const held = useQuery({
    queryKey: ['deliveries', 'counts', { channel }],
    queryFn: () =>
      api.get<{ counts: Record<string, number> }>(`deliveries/counts${query({ channel })}`),
    enabled: open,
  });
  const count = held.data?.counts.held ?? 0;
  const resume = useMutation({
    mutationFn: (send: boolean) => api.post(`channels/${channel}/resume`, { send }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['channels'] });
      void client.invalidateQueries({ queryKey: ['deliveries'] });
      onClose();
    },
  });
  const label = CHANNEL_LABELS[channel];
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resume {label.toLowerCase()}?</AlertDialogTitle>
          <AlertDialogDescription>
            {count > 0
              ? `New deliveries go out again. ${formatNumber(count)} held ${count === 1 ? 'delivery waits' : 'deliveries wait'} from the pause: send them now, or keep them to send or discard one by one under Deliveries.`
              : 'New deliveries go out again.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {resume.error ? (
          <p className="text-destructive text-sm">
            {resume.error instanceof ApiError
              ? resume.error.message
              : 'Something went wrong. Try again.'}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resume.isPending}>Cancel</AlertDialogCancel>
          {count > 0 ? (
            <Button
              variant="outline"
              disabled={resume.isPending}
              onClick={() => resume.mutate(false)}
            >
              Resume, keep them held
            </Button>
          ) : null}
          <Button disabled={resume.isPending || !held.data} onClick={() => resume.mutate(true)}>
            {count > 0 ? `Resume and send ${formatNumber(count)}` : `Resume ${label.toLowerCase()}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export const ChannelsPage = () => {
  const client = useQueryClient();
  const { data, error } = useChannelsOverview();
  const [email, inApp, push] = data?.channels ?? [];
  // The channel outlives the dialog's open state, so its words stay put while it closes.
  const [target, setTarget] = useState<Channel>('email');
  const [dialog, setDialog] = useState<'pause' | 'resume' | null>(null);
  const pause = useMutation({
    mutationFn: (channel: Channel) => api.post(`channels/${channel}/pause`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['channels'] }),
  });
  const control = (channel: Channel, paused: ChannelPause | null) => (
    <PauseButton
      channel={channel}
      paused={paused !== null}
      canPause={data?.canPause ?? false}
      onPause={(key) => {
        setTarget(key);
        setDialog('pause');
      }}
      onResume={(key) => {
        setTarget(key);
        setDialog('resume');
      }}
    />
  );
  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 pt-6 pb-10">
        <PageHeader
          title="Channels"
          description="Set in your Worker’s Chaski config, so changes ship with a deploy. Secrets never show here. A pause stays until someone resumes the channel, deploys included."
        />
        {error ? <ErrorAlert error={error} /> : null}
        {!data || !email || !inApp || !push ? (
          error ? null : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-44" />
              <Skeleton className="h-44" />
            </div>
          )
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChannelPanel
              icon={Mail}
              title="Email"
              description="Sent through the send_email binding of your Worker"
              state={stateOf(email.enabled, email.paused)}
              actions={email.enabled ? control('email', email.paused) : null}
            >
              {email.enabled ? (
                <>
                  {email.paused ? <PausedRow paused={email.paused} /> : null}
                  <Row label="From">{email.from}</Row>
                  <Row label="From name">{email.fromName}</Row>
                  <Row label="Reply-to">{email.replyTo}</Row>
                </>
              ) : (
                <SetupHint configKey="channels.email" />
              )}
            </ChannelPanel>
            <ChannelPanel
              icon={Bell}
              title="In-app"
              description="The feed each contact reads in your app"
              state={stateOf(inApp.enabled, inApp.paused)}
              actions={inApp.enabled ? control('in_app', inApp.paused) : null}
            >
              {inApp.enabled ? (
                <>
                  {inApp.paused ? <PausedRow paused={inApp.paused} /> : null}
                  <Row label="Feed">One ChaskiFeed object per contact, live over a WebSocket</Row>
                </>
              ) : (
                <SetupHint configKey="channels.in_app" />
              )}
            </ChannelPanel>
            <ChannelPanel
              icon={Smartphone}
              title="Push"
              description="Web push with VAPID, iOS through APNs"
              state={stateOf(push.enabled, push.paused)}
              actions={push.enabled ? control('push', push.paused) : null}
            >
              {push.enabled ? (
                <>
                  {push.paused ? <PausedRow paused={push.paused} /> : null}
                  <Row label="Web push">
                    {push.web ? (
                      <code className="font-mono text-xs">{push.web.vapidPublicKey}</code>
                    ) : (
                      'Not configured'
                    )}
                  </Row>
                  <Row label="iOS">
                    {push.ios ? `${push.ios.bundleId} · ${push.ios.environment}` : 'Not configured'}
                  </Row>
                </>
              ) : (
                <SetupHint configKey="channels.push" />
              )}
            </ChannelPanel>
            <ChannelPanel
              icon={Activity}
              title="Delivery"
              description="How sends and this dashboard behave"
              state={null}
            >
              <Row label="Dry run">
                <div className="flex items-start gap-2">
                  {data.dryRun ? <Pill tone="warning">On</Pill> : <Pill tone="neutral">Off</Pill>}
                  <span className="text-muted-foreground">
                    {data.dryRun
                      ? 'Email and push render and record without reaching their providers.'
                      : 'Email and push reach their providers.'}
                  </span>
                </div>
              </Row>
              <Row label="Live updates">
                <div className="flex items-start gap-2">
                  {data.realtime ? <Pill tone="success">On</Pill> : <Pill tone="neutral">Off</Pill>}
                  <span className="text-muted-foreground">
                    {data.realtime
                      ? 'The dashboard shows changes as they happen.'
                      : 'Add bindings.events to see changes as they happen.'}
                  </span>
                </div>
              </Row>
            </ChannelPanel>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={dialog === 'pause'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Pause ${CHANNEL_LABELS[target].toLowerCase()}?`}
        description={`${HOLDS[target]}, until someone resumes the channel. You decide then whether to send or discard each one.`}
        action="Pause channel"
        onConfirm={() => pause.mutateAsync(target)}
      />
      <ResumeDialog channel={target} open={dialog === 'resume'} onClose={() => setDialog(null)} />
    </>
  );
};
