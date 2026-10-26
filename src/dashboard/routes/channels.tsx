import { useQuery } from '@tanstack/react-query';
import { Bell, FlaskConical, Mail, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { SiteHeader } from '~/components/app/site-header';
import { Badge } from '~/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { api } from '~/lib/api';
import type { ChannelsOverview } from '~/lib/types';

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-3 gap-2 py-2 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="col-span-2 break-all">{children ?? '–'}</dd>
  </div>
);

const State = ({ on }: { on: boolean }) => (
  <Badge variant={on ? 'secondary' : 'outline'}>{on ? 'On' : 'Not configured'}</Badge>
);

const ChannelCard = ({
  icon: Icon,
  title,
  description,
  on,
  configKey,
  children,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  on: boolean;
  configKey: string;
  children?: ReactNode;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Icon className="size-4" /> {title}
      </CardTitle>
      <CardDescription>{description}</CardDescription>
      <CardAction>
        <State on={on} />
      </CardAction>
    </CardHeader>
    <CardContent>
      {on ? (
        <dl className="divide-y">{children}</dl>
      ) : (
        <p className="text-muted-foreground text-sm">
          Add <code className="font-mono">{configKey}</code> to the config your Worker passes to{' '}
          <code className="font-mono">createChaski()</code>.
        </p>
      )}
    </CardContent>
  </Card>
);

export const ChannelsPage = () => {
  const { data, error } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<ChannelsOverview>('channels'),
  });
  const [email, inApp, push] = data?.channels ?? [];
  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <PageHeader
          title="Channels"
          description="Set in your Worker’s Chaski config, so changes ship with a deploy. Secrets never show here."
        />
        {error ? <ErrorAlert error={error} /> : null}
        {!data || !email || !inApp || !push ? (
          error ? null : (
            <Skeleton className="h-64" />
          )
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChannelCard
              icon={Mail}
              title="Email"
              description="Sent through the send_email binding of your Worker"
              on={email.enabled}
              configKey="channels.email"
            >
              <Row label="From">{email.from}</Row>
              <Row label="From name">{email.fromName}</Row>
              <Row label="Reply-to">{email.replyTo}</Row>
            </ChannelCard>
            <ChannelCard
              icon={Bell}
              title="In-app"
              description="The feed each contact reads in your app"
              on={inApp.enabled}
              configKey="channels.in_app"
            >
              <Row label="Realtime">One ChaskiFeed object per contact</Row>
            </ChannelCard>
            <ChannelCard
              icon={Smartphone}
              title="Push"
              description="Web push with VAPID, iOS through APNs"
              on={push.enabled}
              configKey="channels.push"
            >
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
            </ChannelCard>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FlaskConical className="size-4" /> Dry run
                </CardTitle>
                <CardDescription>
                  {data.dryRun
                    ? 'Email and push deliveries render and record without reaching their providers.'
                    : 'Email and push deliveries reach their providers.'}
                </CardDescription>
                <CardAction>
                  <Badge variant={data.dryRun ? 'secondary' : 'outline'}>
                    {data.dryRun ? 'On' : 'Off'}
                  </Badge>
                </CardAction>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>
    </>
  );
};
