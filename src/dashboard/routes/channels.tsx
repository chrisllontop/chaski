import { Activity, Bell, Mail, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Panel } from '~/components/app/panel';
import { Pill } from '~/components/app/pill';
import { SiteHeader } from '~/components/app/site-header';
import { Skeleton } from '~/components/ui/skeleton';
import { useChannelsOverview } from '~/lib/channels';

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
  children,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  state: ReactNode;
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
      {state}
    </header>
    <dl className="flex-1 divide-y">{children}</dl>
  </Panel>
);

const configured = (on: boolean) =>
  on ? <Pill tone="success">On</Pill> : <Pill tone="neutral">Not configured</Pill>;

export const ChannelsPage = () => {
  const { data, error } = useChannelsOverview();
  const [email, inApp, push] = data?.channels ?? [];
  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 pt-6 pb-10">
        <PageHeader
          title="Channels"
          description="Set in your Worker’s Chaski config, so changes ship with a deploy. Secrets never show here."
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
              state={configured(email.enabled)}
            >
              {email.enabled ? (
                <>
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
              state={configured(inApp.enabled)}
            >
              {inApp.enabled ? (
                <Row label="Feed">One ChaskiFeed object per contact, live over a WebSocket</Row>
              ) : (
                <SetupHint configKey="channels.in_app" />
              )}
            </ChannelPanel>
            <ChannelPanel
              icon={Smartphone}
              title="Push"
              description="Web push with VAPID, iOS through APNs"
              state={configured(push.enabled)}
            >
              {push.enabled ? (
                <>
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
    </>
  );
};
