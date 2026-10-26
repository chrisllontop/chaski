import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { cn } from 'cn';
import { Send } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '~/components/app/code-editor';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Panel, PanelHeader } from '~/components/app/panel';
import { SiteHeader } from '~/components/app/site-header';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Skeleton } from '~/components/ui/skeleton';
import { Switch } from '~/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import { ApiError, api } from '~/lib/api';
import { useDebounced } from '~/lib/debounce';
import { CHANNEL_LABELS } from '~/lib/format';
import type { Channel, RenderedPreview, TemplateChannelContent, TemplateDetail } from '~/lib/types';

type Draft = { enabled: boolean; subject: string; body: string; textBody: string };

const EMPTY_DRAFT: Draft = { enabled: false, subject: '', body: '', textBody: '' };

// In-app and push keep the title in subject, the message in body and the link
// the notification opens in textBody, the same fields the server renders.
const FIELDS: Record<Channel, { subject: string; body: string; textBody: string }> = {
  email: { subject: 'Subject', body: 'HTML body', textBody: 'Text body' },
  in_app: { subject: 'Title', body: 'Message', textBody: 'Link' },
  push: { subject: 'Title', body: 'Message', textBody: 'Link' },
};

const toDraft = (row: TemplateChannelContent | undefined): Draft =>
  row
    ? {
        enabled: row.enabled,
        subject: row.subject ?? '',
        body: row.body ?? '',
        textBody: row.textBody ?? '',
      }
    : EMPTY_DRAFT;

const parseSample = (text: string): Record<string, unknown> | null => {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

// ─── Previews ───

/**
 * The email renders in an iframe a form posts into: the response carries its
 * own CSP, so the email's inline styles and remote images show without
 * loosening the dashboard's. Its sandbox lets no script run.
 */
const EmailPreview = ({
  templateId,
  draft,
  sample,
}: {
  templateId: string;
  draft: Draft;
  sample: Record<string, unknown>;
}) => {
  const frame = `email-preview-${useId().replace(/:/g, '')}`;
  const form = useRef<HTMLFormElement>(null);
  const debounced = useDebounced({ draft, sample });
  useEffect(() => {
    if (debounced.draft.body) form.current?.requestSubmit();
  }, [debounced]);
  return (
    <>
      <form
        ref={form}
        method="post"
        target={frame}
        action={api.url(`templates/${templateId}/preview/document`)}
        className="hidden"
      >
        <input type="hidden" name="subject" value={debounced.draft.subject} />
        <input type="hidden" name="body" value={debounced.draft.body} />
        <input type="hidden" name="data" value={JSON.stringify(debounced.sample)} />
      </form>
      {draft.body ? (
        <iframe
          name={frame}
          title="Email preview"
          sandbox=""
          className="h-[480px] w-full rounded-md border bg-white"
        />
      ) : (
        <p className="text-muted-foreground text-sm">Write an HTML body to see the email.</p>
      )}
    </>
  );
};

const FeedPreview = ({ rendered }: { rendered: RenderedPreview }) => (
  <div className="rounded-lg border p-4">
    <div className="flex items-start gap-3">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-sm">{rendered.subject || 'Untitled'}</div>
        <div className="text-muted-foreground text-sm">{rendered.html}</div>
        {rendered.text ? (
          <div className="truncate font-mono text-muted-foreground text-xs">{rendered.text}</div>
        ) : null}
      </div>
    </div>
  </div>
);

const PushPreview = ({ rendered }: { rendered: RenderedPreview }) => (
  <div className="max-w-sm rounded-xl border bg-muted/50 p-3 shadow-sm">
    <div className="mb-1 text-muted-foreground text-xs">Your app · now</div>
    <div className="font-medium text-sm">{rendered.subject || 'Untitled'}</div>
    <div className="text-sm">{rendered.html}</div>
  </div>
);

// ─── Send test ───

const SendTestDialog = ({
  templateId,
  sample,
  open,
  onOpenChange,
}: {
  templateId: string;
  sample: Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [to, setTo] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.post<{ messageId: string }>(`templates/${templateId}/test-send`, { to, data: sample }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        send.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>
              The saved email content, rendered with the sample data, goes to this address with
              “[test]” before the subject.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="test-to">To</Label>
            <Input
              id="test-to"
              type="email"
              required
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          {send.data ? <p className="text-sm">Sent to {to}.</p> : null}
          {send.error ? (
            <p className="text-destructive text-sm">
              {send.error instanceof ApiError
                ? send.error.message
                : 'The test didn’t go out. Try again.'}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={send.isPending || !to}>
              <Send /> Send test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ─── Page ───

export const TemplateEditorPage = () => {
  const { templateId } = useParams({ from: '/templates/$templateId' });
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['template', templateId],
    queryFn: () => api.get<TemplateDetail>(`templates/${templateId}`),
  });
  const [channel, setChannel] = useState<Channel>('email');
  const [drafts, setDrafts] = useState<Record<Channel, Draft> | null>(null);
  const [sampleText, setSampleText] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // The drafts start from the stored content and stay the user's until saved.
  useEffect(() => {
    if (!detail.data || drafts) return;
    const byChannel = (c: Channel) => detail.data.channels.find((row) => row.channel === c);
    setDrafts({
      email: toDraft(byChannel('email')),
      in_app: toDraft(byChannel('in_app')),
      push: toDraft(byChannel('push')),
    });
    setSampleText(detail.data.template.sampleData ?? '{}');
  }, [detail.data, drafts]);

  const draft = drafts?.[channel] ?? EMPTY_DRAFT;
  const sample = useMemo(() => parseSample(sampleText ?? '{}'), [sampleText]);
  const stored = toDraft(detail.data?.channels.find((row) => row.channel === channel));
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const unsaved = (key: Channel) =>
    drafts !== null &&
    JSON.stringify(drafts[key]) !==
      JSON.stringify(toDraft(detail.data?.channels.find((row) => row.channel === key)));
  const sampleDirty = sampleText !== (detail.data?.template.sampleData ?? '{}');

  const debounced = useDebounced({ channel, draft, sample });
  const preview = useQuery({
    queryKey: ['template', templateId, 'preview', debounced],
    queryFn: () =>
      api.post<RenderedPreview>(`templates/${templateId}/preview`, {
        channel: debounced.channel,
        data: debounced.sample ?? {},
        content: {
          subject: debounced.draft.subject,
          body: debounced.draft.body,
          textBody: debounced.draft.textBody,
        },
      }),
    enabled: Boolean(debounced.draft.body) && debounced.sample !== null,
    retry: false,
  });

  const saveChannel = useMutation({
    mutationFn: () =>
      api.put(`templates/${templateId}/channels/${channel}`, {
        enabled: draft.enabled,
        subject: draft.subject || null,
        body: draft.body || null,
        textBody: draft.textBody || null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['template', templateId] });
      void client.invalidateQueries({ queryKey: ['templates'] });
    },
  });
  const saveSample = useMutation({
    mutationFn: () => api.patch(`templates/${templateId}`, { sampleData: sampleText }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['template', templateId] }),
  });

  const update = (patch: Partial<Draft>) =>
    setDrafts((current) =>
      current ? { ...current, [channel]: { ...current[channel], ...patch } } : current,
    );

  const template = detail.data?.template;
  const labels = FIELDS[channel];

  return (
    <>
      <SiteHeader current={template?.type} />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 pt-6 pb-10">
        {detail.error ? <ErrorAlert error={detail.error} /> : null}
        {!template || !drafts ? (
          detail.error ? null : (
            <Skeleton className="h-96" />
          )
        ) : (
          <>
            <PageHeader
              title={<span className="font-mono">{template.type}</span>}
              description={
                <span className="flex items-center gap-2">
                  {template.topic ? (
                    <span className="inline-flex h-5 items-center rounded-md border px-1.5 text-xs">
                      {template.topic}
                    </span>
                  ) : null}
                  {template.description}
                </span>
              }
              actions={
                channel === 'email' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTesting(true)}
                    disabled={!stored.body}
                  >
                    <Send /> Send test
                  </Button>
                ) : null
              }
            />
            <Tabs value={channel} onValueChange={(value) => setChannel(value as Channel)}>
              <TabsList variant="line" className="w-full justify-start border-b">
                {(['email', 'in_app', 'push'] as Channel[]).map((key) => (
                  <TabsTrigger key={key} value={key} className="flex-none px-3">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        drafts[key].enabled ? 'bg-success' : 'bg-muted-foreground/40',
                      )}
                    />
                    {CHANNEL_LABELS[key]}
                    {unsaved(key) ? (
                      <span className="text-muted-foreground text-xs">· unsaved</span>
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="grid content-start gap-4">
                <Panel>
                  <PanelHeader
                    title={`${CHANNEL_LABELS[channel]} content`}
                    description="Liquid tags such as {{ amount }} read the payload of each send."
                    actions={
                      <div className="flex items-center gap-2">
                        <Label htmlFor="channel-enabled" className="font-normal text-xs">
                          {draft.enabled ? 'Enabled' : 'Disabled'}
                        </Label>
                        <Switch
                          id="channel-enabled"
                          checked={draft.enabled}
                          onCheckedChange={(enabled) => update({ enabled })}
                        />
                      </div>
                    }
                  />
                  <div className="grid gap-4 p-4">
                    <div className="grid gap-2">
                      <Label htmlFor="field-subject">{labels.subject}</Label>
                      <Input
                        id="field-subject"
                        value={draft.subject}
                        onChange={(event) => update({ subject: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label
                        id="field-body-label"
                        htmlFor={channel === 'email' ? undefined : 'field-body'}
                      >
                        {labels.body}
                      </Label>
                      {channel === 'email' ? (
                        <CodeEditor
                          value={draft.body}
                          onChange={(body) => update({ body })}
                          language="html"
                          sample={sample}
                          labelledBy="field-body-label"
                          className="[&_.cm-scroller]:max-h-[32rem] [&_.cm-scroller]:min-h-56"
                        />
                      ) : (
                        <Textarea
                          id="field-body"
                          value={draft.body}
                          onChange={(event) => update({ body: event.target.value })}
                          className="min-h-24"
                        />
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="field-text">{labels.textBody}</Label>
                      {channel === 'email' ? (
                        <Textarea
                          id="field-text"
                          value={draft.textBody}
                          onChange={(event) => update({ textBody: event.target.value })}
                          className="min-h-24 font-mono text-xs"
                        />
                      ) : (
                        <Input
                          id="field-text"
                          value={draft.textBody}
                          placeholder="/payments/{{ id }}"
                          onChange={(event) => update({ textBody: event.target.value })}
                          className="font-mono"
                        />
                      )}
                    </div>
                    {saveChannel.error ? <ErrorAlert error={saveChannel.error} /> : null}
                  </div>
                  <footer className="flex items-center justify-end gap-2 border-t bg-muted/30 px-4 py-2.5">
                    {dirty ? (
                      <span className="mr-auto text-muted-foreground text-xs">Unsaved changes</span>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!dirty}
                      onClick={() => update(stored)}
                    >
                      Discard changes
                    </Button>
                    <Button
                      size="sm"
                      disabled={!dirty || saveChannel.isPending}
                      onClick={() => saveChannel.mutate()}
                    >
                      Save {CHANNEL_LABELS[channel]}
                    </Button>
                  </footer>
                </Panel>
                <Panel>
                  <PanelHeader
                    title={<span id="sample-data-title">Sample data</span>}
                    description={
                      <>
                        What the preview renders with. Sends fill{' '}
                        <code className="font-mono">recipient</code> from the contact.
                      </>
                    }
                  />
                  <div className="grid gap-2 p-4">
                    <CodeEditor
                      value={sampleText ?? ''}
                      onChange={setSampleText}
                      language="json"
                      labelledBy="sample-data-title"
                      invalid={sample === null}
                      className="[&_.cm-scroller]:min-h-32"
                    />
                    {sample === null ? (
                      <p className="text-destructive text-xs">
                        The sample data must be a JSON object.
                      </p>
                    ) : null}
                  </div>
                  <footer className="flex justify-end border-t bg-muted/30 px-4 py-2.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!sampleDirty || sample === null || saveSample.isPending}
                      onClick={() => saveSample.mutate()}
                    >
                      Save sample data
                    </Button>
                  </footer>
                </Panel>
              </div>
              <Panel className="lg:sticky lg:top-16">
                <PanelHeader
                  title="Preview"
                  description={
                    channel === 'email'
                      ? 'As the email renders, with the sample data'
                      : channel === 'in_app'
                        ? 'As the item shows in the feed'
                        : 'As the notification shows on a device'
                  }
                />
                <div className="grid gap-3 p-4">
                  {sample === null ? (
                    <p className="text-muted-foreground text-sm">
                      Fix the sample data to see the preview.
                    </p>
                  ) : channel === 'email' ? (
                    <>
                      {preview.data?.subject ? (
                        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[13px]">
                          <span className="text-muted-foreground">Subject </span>
                          <span className="font-medium">{preview.data.subject}</span>
                        </div>
                      ) : null}
                      {/* The frame shows what Liquid rejects in the subject or body. */}
                      <EmailPreview templateId={templateId} draft={draft} sample={sample} />
                    </>
                  ) : !draft.body ? (
                    <p className="text-muted-foreground text-sm">
                      Write a message to see the preview.
                    </p>
                  ) : preview.error ? (
                    <ErrorAlert error={preview.error} title="We couldn’t render this preview." />
                  ) : preview.data ? (
                    channel === 'in_app' ? (
                      <FeedPreview rendered={preview.data} />
                    ) : (
                      <PushPreview rendered={preview.data} />
                    )
                  ) : (
                    <Skeleton className="h-20" />
                  )}
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
      {template ? (
        <SendTestDialog
          templateId={templateId}
          sample={sample ?? {}}
          open={testing}
          onOpenChange={setTesting}
        />
      ) : null}
    </>
  );
};
