import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  BellOff,
  CircleAlert,
  KeyRound,
  Mail,
  Pause,
  Pencil,
  Play,
  Plus,
  Smartphone,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  ApnsDialog,
  EmailDialog,
  FcmDialog,
  MutedTypesDialog,
  VapidDialog,
  WnsDialog,
} from '~/components/app/channel-settings';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Panel } from '~/components/app/panel';
import { Pill } from '~/components/app/pill';
import { SiteHeader } from '~/components/app/site-header';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
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
import { ApiError, api, query } from '~/lib/api';
import { useChannelsOverview } from '~/lib/channels';
import { CHANNEL_LABELS, formatDateTime, formatNumber, formatRelative } from '~/lib/format';
import type {
  Actor,
  ApnsApp,
  Channel,
  ChannelPause,
  ChannelsOverview,
  PushProvider,
  SavedMeta,
} from '~/lib/types';

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5 text-[13px]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 wrap-anywhere">
      {children ?? <span className="text-muted-foreground">–</span>}
    </dd>
  </div>
);

const Note = ({ children }: { children: ReactNode }) => (
  <p className="text-pretty px-4 py-3 text-muted-foreground text-sm">{children}</p>
);

const ChannelPanel = ({
  icon: Icon,
  title,
  description,
  state,
  actions = null,
  className,
  children,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  state: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) => (
  <Panel className={className ? `flex flex-col ${className}` : 'flex flex-col'}>
    <header className="flex flex-wrap items-start gap-3 border-b px-4 py-3">
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

const stateOf = (on: boolean, paused: ChannelPause | null, failing: boolean) => {
  if (!on) return <Pill tone="neutral">Off</Pill>;
  if (paused) return <Pill tone="warning">Paused</Pill>;
  return failing ? <Pill tone="danger">Failing</Pill> : <Pill tone="success">On</Pill>;
};

const When = ({ at }: { at: string }) => (
  <time dateTime={at} title={formatDateTime(at)}>
    {formatRelative(at)}
  </time>
);

const actorName = (actor: Actor) => actor.name ?? actor.id;

const SavedRow = ({ label, saved }: { label: string; saved: SavedMeta }) => (
  <Row label={label}>
    {actorName(saved.updatedBy)} · <When at={saved.updatedAt} />
  </Row>
);

/** A saved section that stopped validating: its deliveries fail with this reason. */
const Problem = ({ message }: { message: string }) => (
  <div className="px-4 py-3">
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>Deliveries fail until this is fixed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  </div>
);

// What a pause stops, said per channel so the dialog names what the reader is about to hold.
const HOLDS: Record<Channel, string> = {
  email: 'Every email waits as held, password resets included',
  in_app: 'Every in-app notification waits as held, out of each contact’s feed',
  push: 'Every push notification waits as held',
};

const PausedRow = ({ paused }: { paused: ChannelPause }) => (
  <Row label="Paused by">
    {actorName(paused.pausedBy)} · <When at={paused.pausedAt} />
  </Row>
);

const PauseButton = ({
  channel,
  paused,
  onPause,
  onResume,
}: {
  channel: Channel;
  paused: boolean;
  onPause: (channel: Channel) => void;
  onResume: (channel: Channel) => void;
}) => (
  <Button
    variant="outline"
    size="sm"
    onClick={() => (paused ? onResume(channel) : onPause(channel))}
  >
    {paused ? <Play /> : <Pause />} {paused ? 'Resume' : 'Pause'}
  </Button>
);

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

type Removable = 'email' | 'in_app' | PushProvider;

// Removing a section turns its channel, or its push provider, off; each dialog says what stops.
const REMOVALS: Record<
  Removable,
  { path: string; title: string; description: string; action: string }
> = {
  email: {
    path: 'channels/email',
    title: 'Remove the email settings?',
    description: 'Email turns off: sends skip it, and email deliveries still queued fail.',
    action: 'Remove email',
  },
  in_app: {
    path: 'channels/in_app',
    title: 'Turn off in-app?',
    description:
      'New notifications skip the feed, and in-app deliveries still queued fail. Each contact’s feed keeps what it already holds.',
    action: 'Turn off in-app',
  },
  vapid: {
    path: 'channels/push/vapid',
    title: 'Remove web push?',
    description:
      'Browsers stop receiving push until web push is set up again. With new keys, each browser has to subscribe again.',
    action: 'Remove web push',
  },
  apns: {
    path: 'channels/push/apns',
    title: 'Remove APNs?',
    description: 'iPhones, iPads and Macs stop receiving push until APNs is set up again.',
    action: 'Remove APNs',
  },
  fcm: {
    path: 'channels/push/fcm',
    title: 'Remove FCM?',
    description: 'Android devices stop receiving push until FCM is set up again.',
    action: 'Remove FCM',
  },
  wns: {
    path: 'channels/push/wns',
    title: 'Remove WNS?',
    description: 'Windows devices stop receiving push until WNS is set up again.',
    action: 'Remove WNS',
  },
};

const ENVIRONMENT_NAMES = { sandbox: 'Sandbox', production: 'Production' } as const;

const appLine = (platform: string, app: ApnsApp | null) =>
  app ? `${platform} ${app.bundleId} · ${ENVIRONMENT_NAMES[app.environment]}` : null;

/** One push provider: what it reaches once set up, and why it fails, if it does. */
const ProviderRow = ({
  label,
  saved,
  summary,
  canSetUp,
  onEdit,
}: {
  label: string;
  saved: SavedMeta | null;
  summary: ReactNode;
  canSetUp: boolean;
  onEdit: () => void;
}) => (
  <div className="grid grid-cols-[8rem_1fr_auto] items-start gap-3 px-4 py-2.5 text-[13px]">
    <dt className="pt-0.5 text-muted-foreground">{label}</dt>
    <dd className="min-w-0 wrap-anywhere pt-0.5">
      {saved ? (
        <div className="grid gap-0.5">
          <div>{summary}</div>
          {saved.problem ? <p className="text-destructive">{saved.problem}</p> : null}
          <p className="text-muted-foreground text-xs">
            {actorName(saved.updatedBy)} · <When at={saved.updatedAt} />
          </p>
        </div>
      ) : (
        <span className="text-muted-foreground">Off</span>
      )}
    </dd>
    <dd>
      <Button variant="outline" size="xs" disabled={!saved && !canSetUp} onClick={onEdit}>
        {saved ? <Pencil /> : <Plus />} {saved ? 'Edit' : 'Set up'}
      </Button>
    </dd>
  </div>
);

// Push credentials are sealed with CHASKI_SECRET, so nothing can be saved until it is set, and
// what was saved opens only with the secret it was saved with.
const SecretHint = ({
  status,
  saved,
}: {
  status: Exclude<ChannelsOverview['secret'], 'set'>;
  saved: boolean;
}) => (
  <div className="px-4 py-3">
    <Alert>
      <KeyRound />
      <AlertTitle>
        {status === 'missing' ? 'Push needs CHASKI_SECRET' : 'CHASKI_SECRET is too short'}
      </AlertTitle>
      <AlertDescription>
        <p>
          {saved
            ? 'The saved push credentials open only with the CHASKI_SECRET they were saved with. Set that one again, or set a new one from your Chaski project and save each provider again:'
            : status === 'missing'
              ? 'Push credentials are stored encrypted with it. Set one from your Chaski project:'
              : 'It needs at least 32 characters. Set a new one from your Chaski project:'}
        </p>
        <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-foreground text-xs">
          openssl rand -base64 32 | wrangler secret put CHASKI_SECRET
        </code>
      </AlertDescription>
    </Alert>
  </div>
);

type Editing = 'email' | PushProvider | 'muted';

export const ChannelsPage = () => {
  const client = useQueryClient();
  const { data, error } = useChannelsOverview();
  const [email, inApp, push] = data?.channels ?? [];
  // The channel outlives the dialog's open state, so its words stay put while it closes.
  const [target, setTarget] = useState<Channel>('email');
  const [dialog, setDialog] = useState<'pause' | 'resume' | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<Removable>('email');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const pause = useMutation({
    mutationFn: (channel: Channel) => api.post(`channels/${channel}/pause`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['channels'] }),
  });
  const turnOnInApp = useMutation({
    mutationFn: () => api.put('channels/in_app', {}),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['channels'] }),
  });
  const remove = (section: Removable) => {
    setEditing(null);
    setRemoving(section);
    setConfirmRemove(true);
  };
  const control = (channel: Channel, paused: ChannelPause | null) => (
    <PauseButton
      channel={channel}
      paused={paused !== null}
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
  const editOpen = (section: Editing) => ({
    open: editing === section,
    onOpenChange: (open: boolean) => setEditing(open ? section : null),
  });

  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 pt-6 pb-10">
        <PageHeader
          title="Channels"
          description="A channel sends once its settings are saved here. Secrets are write-only: you can replace them, not read them. A pause stays until someone resumes the channel, deploys included."
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
              description="Sent through the CHASKI_EMAIL send_email binding"
              state={stateOf(email.enabled, email.paused, Boolean(email.settings?.problem))}
              actions={
                <>
                  {email.settings || data.bindings.email ? (
                    <Button variant="outline" size="sm" onClick={() => setEditing('email')}>
                      {email.settings ? <Pencil /> : <Plus />}{' '}
                      {email.settings ? 'Edit' : 'Set up email'}
                    </Button>
                  ) : null}
                  {email.enabled ? control('email', email.paused) : null}
                </>
              }
            >
              {email.settings?.problem ? <Problem message={email.settings.problem} /> : null}
              {email.paused ? <PausedRow paused={email.paused} /> : null}
              {email.settings ? (
                <>
                  <Row label="From">{email.settings.from}</Row>
                  <Row label="From name">{email.settings.fromName}</Row>
                  <Row label="Reply-to">{email.settings.replyTo}</Row>
                  <SavedRow label="Saved by" saved={email.settings} />
                </>
              ) : email.enabled ? null : data.bindings.email ? (
                <Note>Email is off. Set the address it sends from to turn it on.</Note>
              ) : (
                <Note>
                  Add a send_email binding named CHASKI_EMAIL to this Worker’s wrangler.jsonc and
                  deploy it, then set up email here.
                </Note>
              )}
            </ChannelPanel>

            <ChannelPanel
              icon={Bell}
              title="In-app"
              description="The feed each contact reads in your app"
              state={stateOf(inApp.enabled, inApp.paused, Boolean(inApp.settings?.problem))}
              actions={
                <>
                  {inApp.settings ? (
                    <Button variant="outline" size="sm" onClick={() => remove('in_app')}>
                      Turn off
                    </Button>
                  ) : data.bindings.feed && !inApp.enabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={turnOnInApp.isPending}
                      onClick={() => turnOnInApp.mutate()}
                    >
                      {turnOnInApp.isPending ? 'Turning on…' : 'Turn on in-app'}
                    </Button>
                  ) : null}
                  {inApp.enabled ? control('in_app', inApp.paused) : null}
                </>
              }
            >
              {inApp.settings?.problem ? <Problem message={inApp.settings.problem} /> : null}
              {inApp.paused ? <PausedRow paused={inApp.paused} /> : null}
              {inApp.enabled ? (
                <Row label="Feed">One ChaskiFeed object per contact, live over a WebSocket</Row>
              ) : data.bindings.feed ? (
                <Note>
                  In-app is off. Turn it on to put each notification in the contact’s feed.
                </Note>
              ) : (
                <Note>
                  Add a Durable Object binding named CHASKI_FEED, for the ChaskiFeed class, to this
                  Worker’s wrangler.jsonc and deploy it, then turn in-app on here.
                </Note>
              )}
              {inApp.settings ? <SavedRow label="Turned on by" saved={inApp.settings} /> : null}
              {turnOnInApp.error ? (
                <p className="px-4 py-3 text-destructive text-sm">
                  {turnOnInApp.error instanceof ApiError
                    ? turnOnInApp.error.message
                    : 'We couldn’t turn on in-app. Please try again.'}
                </p>
              ) : null}
            </ChannelPanel>

            <ChannelPanel
              className="lg:col-span-2"
              icon={Smartphone}
              title="Push"
              description="On once any provider is set up; each one reaches its own devices"
              state={stateOf(
                push.enabled,
                push.paused,
                Object.values(push.providers).some((provider) => provider?.problem),
              )}
              actions={push.enabled ? control('push', push.paused) : null}
            >
              {data.secret === 'set' ? null : (
                <SecretHint
                  status={data.secret}
                  saved={Object.values(push.providers).some(Boolean)}
                />
              )}
              {push.paused ? <PausedRow paused={push.paused} /> : null}
              <ProviderRow
                label="Web push"
                saved={push.providers.vapid}
                canSetUp={data.secret === 'set'}
                onEdit={() => setEditing('vapid')}
                summary={
                  <code className="font-mono text-xs">{push.providers.vapid?.publicKey}</code>
                }
              />
              <ProviderRow
                label="APNs"
                saved={push.providers.apns}
                canSetUp={data.secret === 'set'}
                onEdit={() => setEditing('apns')}
                summary={[
                  appLine('iOS', push.providers.apns?.ios ?? null),
                  appLine('macOS', push.providers.apns?.macos ?? null),
                ]
                  .filter(Boolean)
                  .map((line) => <div key={line}>{line}</div>)}
              />
              <ProviderRow
                label="FCM"
                saved={push.providers.fcm}
                canSetUp={data.secret === 'set'}
                onEdit={() => setEditing('fcm')}
                summary={push.providers.fcm?.projectId ?? 'Service account saved'}
              />
              <ProviderRow
                label="WNS"
                saved={push.providers.wns}
                canSetUp={data.secret === 'set'}
                onEdit={() => setEditing('wns')}
                summary={push.providers.wns?.clientId}
              />
            </ChannelPanel>

            <ChannelPanel
              icon={BellOff}
              title="Muted by default"
              description="Types every contact has muted until they save preferences of their own"
              state={null}
              actions={
                <Button variant="outline" size="sm" onClick={() => setEditing('muted')}>
                  <Pencil /> Edit
                </Button>
              }
            >
              {data.defaultMutedTypes.problem ? (
                <Note>{data.defaultMutedTypes.problem}</Note>
              ) : null}
              <Row label="Types">
                {data.defaultMutedTypes.mutedTypes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.defaultMutedTypes.mutedTypes.map((type) => (
                      <code key={type} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {type}
                      </code>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </Row>
              {data.defaultMutedTypes.updatedBy && data.defaultMutedTypes.updatedAt ? (
                <Row label="Saved by">
                  {actorName(data.defaultMutedTypes.updatedBy)} ·{' '}
                  <When at={data.defaultMutedTypes.updatedAt} />
                </Row>
              ) : null}
            </ChannelPanel>

            <ChannelPanel
              icon={Activity}
              title="Delivery"
              description="How sends and this dashboard behave"
              state={null}
            >
              <Row label="Environment">
                <div className="flex items-start gap-2">
                  {data.environment ? (
                    <Pill tone="info">{data.environment}</Pill>
                  ) : (
                    <Pill tone="neutral">Not named</Pill>
                  )}
                  <span className="text-muted-foreground">
                    {data.environment
                      ? 'Named by CHASKI_ENVIRONMENT in this Worker’s wrangler.jsonc.'
                      : 'Set CHASKI_ENVIRONMENT in this Worker’s wrangler.jsonc to show where it runs.'}
                  </span>
                </div>
              </Row>
              <Row label="Live updates">
                <div className="flex items-start gap-2">
                  {data.realtime ? <Pill tone="success">On</Pill> : <Pill tone="neutral">Off</Pill>}
                  <span className="text-muted-foreground">
                    {data.realtime
                      ? 'The dashboard shows changes as they happen.'
                      : 'Add the CHASKI_EVENTS binding to see changes as they happen.'}
                  </span>
                </div>
              </Row>
            </ChannelPanel>
          </div>
        )}
      </div>

      {email && push && data ? (
        <>
          <EmailDialog
            {...editOpen('email')}
            settings={email.settings}
            onRemove={() => remove('email')}
          />
          <VapidDialog
            {...editOpen('vapid')}
            settings={push.providers.vapid}
            onRemove={() => remove('vapid')}
          />
          <ApnsDialog
            {...editOpen('apns')}
            settings={push.providers.apns}
            onRemove={() => remove('apns')}
          />
          <FcmDialog
            {...editOpen('fcm')}
            settings={push.providers.fcm}
            onRemove={() => remove('fcm')}
          />
          <WnsDialog
            {...editOpen('wns')}
            settings={push.providers.wns}
            onRemove={() => remove('wns')}
          />
          <MutedTypesDialog {...editOpen('muted')} mutedTypes={data.defaultMutedTypes.mutedTypes} />
        </>
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={REMOVALS[removing].title}
        description={REMOVALS[removing].description}
        action={REMOVALS[removing].action}
        onConfirm={async () => {
          await api.delete(REMOVALS[removing].path);
          await client.invalidateQueries({ queryKey: ['channels'] });
        }}
      />
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
