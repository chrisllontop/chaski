import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronDown, Copy, Info, Languages, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '~/components/app/code-editor';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import { LanguageDialog, LanguageLabel } from '~/components/app/languages';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Panel, PanelHeader } from '~/components/app/panel';
import { Pill } from '~/components/app/pill';
import { SiteHeader } from '~/components/app/site-header';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Skeleton } from '~/components/ui/skeleton';
import { Switch } from '~/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import { ApiError, api } from '~/lib/api';
import { useDebounced } from '~/lib/debounce';
import { CHANNEL_LABELS, formatDay } from '~/lib/format';
import {
  CONTENT_NOUNS,
  channelSends,
  languageName,
  languageStatus,
  languagesOf,
  listOf,
  statusIn,
  useLocales,
} from '~/lib/locales';
import type {
  Channel,
  RenderedPreview,
  TemplateChannelContent,
  TemplateDetail,
  TranslationStatus,
} from '~/lib/types';
import { htmlEntities, isPlainTextField } from '../../contract/html-entities';

type Text = { subject: string; body: string; textBody: string };
type Draft = Text & { enabled: boolean };

const EMPTY_TEXT: Text = { subject: '', body: '', textBody: '' };
const EMPTY_DRAFT: Draft = { enabled: false, ...EMPTY_TEXT };

// Chaski sends plain text as written, so an entity pasted from an HTML tool reaches the inbox as
// typed. The editor points it out and leaves the decision to the author.
const PlainTextNotice = ({
  channel,
  field,
  value,
}: {
  channel: Channel;
  field: 'subject' | 'body' | 'textBody';
  value: string;
}) => {
  const entities = isPlainTextField(channel, field) ? htmlEntities(value) : [];
  if (entities.length === 0) return null;
  return (
    <p className="text-warning text-xs">Plain text: {entities.join(', ')} will appear as typed.</p>
  );
};

// In-app and push keep the title in subject, the message in body and the link
// the notification opens in textBody, the same fields the server renders.
const FIELDS: Record<Channel, { subject: string; body: string; textBody: string }> = {
  email: { subject: 'Subject', body: 'HTML body', textBody: 'Text body' },
  in_app: { subject: 'Title', body: 'Message', textBody: 'Link' },
  push: { subject: 'Title', body: 'Message', textBody: 'Link' },
};

// A channel's content as its own tab names it: the email, the item, the notification.
const CONTENT_ON_TAB: Record<Channel, string> = {
  email: 'email',
  in_app: 'item',
  push: 'notification',
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

const toText = (row: { subject: string | null; body: string | null; textBody: string | null }) => ({
  subject: row.subject ?? '',
  body: row.body ?? '',
  textBody: row.textBody ?? '',
});

const sameText = (a: Text, b: Text) =>
  a.subject === b.subject && a.body === b.body && a.textBody === b.textBody;

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
  content,
  locale,
  sample,
}: {
  templateId: string;
  content: Text;
  /** The language the draft is in; without one it renders in the default. */
  locale?: string;
  sample: Record<string, unknown>;
}) => {
  const frame = `email-preview-${useId().replace(/:/g, '')}`;
  const form = useRef<HTMLFormElement>(null);
  const debounced = useDebounced({ content, locale, sample });
  useEffect(() => {
    if (debounced.content.body) form.current?.requestSubmit();
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
        <input type="hidden" name="subject" value={debounced.content.subject} />
        <input type="hidden" name="body" value={debounced.content.body} />
        <input type="hidden" name="data" value={JSON.stringify(debounced.sample)} />
        {debounced.locale ? <input type="hidden" name="locale" value={debounced.locale} /> : null}
      </form>
      {content.body ? (
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

const previewDescription = (
  channel: Channel,
  language: { name: string; defaultName: string; missing: boolean } | null,
) => {
  if (!language) {
    if (channel === 'email') return 'As the email renders, with the sample data';
    return channel === 'in_app'
      ? 'As the item shows in the feed'
      : 'As the notification shows on a device';
  }
  const { name, defaultName, missing } = language;
  if (missing)
    return `What ${name} contacts get now: the ${defaultName} ${CONTENT_ON_TAB[channel]}`;
  if (channel === 'email') return `As the ${name} email renders, with the sample data`;
  return channel === 'in_app'
    ? `As the ${name} item shows in the feed`
    : `As the ${name} notification shows on a device`;
};

// ─── Send test ───

type TestLanguage = { name: string; translated: boolean; defaultName: string };

// What the test sends, for the language it goes out in: a missing translation sends the default.
const testDescription = (language: TestLanguage | null) =>
  !language
    ? 'The saved email content, rendered with the sample data, goes to this address with “[test]” before the subject.'
    : language.translated
      ? `The saved ${language.name} email, rendered with the sample data, goes to this address with “[test]” before the subject.`
      : `${language.name} contacts get the ${language.defaultName} email for now, so the saved ${language.defaultName} email, rendered with the sample data, goes to this address with “[test]” before the subject.`;

const SendTestDialog = ({
  templateId,
  sample,
  locale,
  language,
  open,
  onOpenChange,
}: {
  templateId: string;
  sample: Record<string, unknown>;
  /** The language to send in, resolved as a send would; null sends the default content. */
  locale: string | null;
  language: TestLanguage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [to, setTo] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.post<{ messageId: string }>(`templates/${templateId}/test-send`, {
        to,
        data: sample,
        locale: locale ?? undefined,
      }),
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
            <DialogDescription>{testDescription(language)}</DialogDescription>
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

// ─── Languages ───

type LanguageEntry = { locale: string; note: string; attention: boolean };

/** Picks the language the whole page edits: content, preview and Send test. */
const LanguageMenu = ({
  type,
  current,
  entries,
  onSelect,
  onAdd,
  onRemove,
}: {
  type: string;
  current: string;
  entries: LanguageEntry[];
  onSelect: (locale: string) => void;
  onAdd: () => void;
  /** Only while the template has content in the current language. */
  onRemove?: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" className="font-normal text-[13px]">
        <Languages className="text-muted-foreground" />
        <LanguageLabel locale={current} />
        <ChevronDown className="text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-80">
      <DropdownMenuLabel className="text-muted-foreground text-xs">
        Languages of {type}
      </DropdownMenuLabel>
      {entries.map((entry) => (
        <DropdownMenuCheckboxItem
          key={entry.locale}
          checked={entry.locale === current}
          onSelect={() => onSelect(entry.locale)}
        >
          <LanguageLabel locale={entry.locale} />
          <span
            className={cn(
              'ml-auto text-xs',
              entry.attention ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {entry.note}
          </span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onAdd}>
        <Plus /> Add language
      </DropdownMenuItem>
      {onRemove ? (
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2 /> Remove {languageName(current)}
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
);

// A tab's word for how the selected language stands on that channel.
const STATUS_SUFFIX: Record<Exclude<TranslationStatus, 'complete'>, string> = {
  outdated: 'text-chart-2',
  missing: 'text-warning',
};

const TabSuffix = ({ unsaved, status }: { unsaved: boolean; status: TranslationStatus | null }) =>
  unsaved ? (
    <span className="text-muted-foreground text-xs">· unsaved</span>
  ) : status && status !== 'complete' ? (
    <span className={cn('font-medium text-xs', STATUS_SUFFIX[status])}>· {status}</span>
  ) : null;

// ─── Page ───

export const TemplateEditorPage = () => {
  const { templateId } = useParams({ from: '/templates/$templateId' });
  const search = useSearch({ from: '/templates/$templateId' });
  const navigate = useNavigate();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['template', templateId],
    queryFn: () => api.get<TemplateDetail>(`templates/${templateId}`),
  });
  const languages = languagesOf(useLocales().data);
  // The language being edited; null is the default content, the one every template starts in.
  const locale =
    languages && search.locale && languages.supported.includes(search.locale)
      ? search.locale
      : null;
  const [channel, setChannel] = useState<Channel>('email');
  const [drafts, setDrafts] = useState<Record<Channel, Draft> | null>(null);
  // Translations being edited, by `locale/channel`; one without an entry shows what's saved.
  const [edits, setEdits] = useState<Record<string, Text>>({});
  const [sampleText, setSampleText] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [startFromDefault, setStartFromDefault] = useState(true);
  // The language outlives the dialog's open state, so its words stay put while it closes.
  const [removal, setRemoval] = useState<{ locale: string; contents: string[] } | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState(false);

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

  const rows = detail.data?.channels ?? [];
  const rowOf = (c: Channel) => rows.find((row) => row.channel === c);
  const row = rowOf(channel);
  const savedTranslation = (l: string, c: Channel) =>
    rowOf(c)?.translations.find((translation) => translation.locale === l);
  const editKey = (l: string, c: Channel) => `${l}/${c}`;
  const translationDirty = (l: string, c: Channel) => {
    const edit = edits[editKey(l, c)];
    const saved = savedTranslation(l, c);
    return edit !== undefined && (!saved || !sameText(edit, toText(saved)));
  };

  const defaultDraft = drafts?.[channel] ?? EMPTY_DRAFT;
  const stored = toDraft(row);
  const translation = locale ? savedTranslation(locale, channel) : undefined;
  // Without a saved translation or a draft of one, the channel shows what its contacts get now.
  const text: Text | null = locale
    ? (edits[editKey(locale, channel)] ?? (translation ? toText(translation) : null))
    : defaultDraft;
  const missing = text === null;
  const draft = text ?? EMPTY_TEXT;
  const sample = useMemo(() => parseSample(sampleText ?? '{}'), [sampleText]);
  const dirty = locale
    ? translationDirty(locale, channel)
    : JSON.stringify(defaultDraft) !== JSON.stringify(stored);
  const unsaved = (key: Channel) =>
    locale
      ? translationDirty(locale, key)
      : drafts !== null && JSON.stringify(drafts[key]) !== JSON.stringify(toDraft(rowOf(key)));
  const sampleDirty = sampleText !== (detail.data?.template.sampleData ?? '{}');

  // A missing translation previews what a send resolves to: the stored content, as a send would.
  const debounced = useDebounced({ channel, content: text, locale, sample });
  const preview = useQuery({
    queryKey: ['template', templateId, 'preview', debounced],
    queryFn: () =>
      api.post<RenderedPreview>(`templates/${templateId}/preview`, {
        channel: debounced.channel,
        data: debounced.sample ?? {},
        locale: debounced.locale ?? undefined,
        content: debounced.content
          ? {
              subject: debounced.content.subject,
              body: debounced.content.body,
              textBody: debounced.content.textBody,
            }
          : undefined,
      }),
    enabled:
      Boolean(debounced.content ? debounced.content.body : row?.body) && debounced.sample !== null,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['template', templateId] });
    await client.invalidateQueries({ queryKey: ['templates'] });
    await client.invalidateQueries({ queryKey: ['locales'] });
  };
  const dropEdits = (match: (key: string, edit: Text) => boolean) =>
    setEdits((current) =>
      Object.fromEntries(Object.entries(current).filter(([key, edit]) => !match(key, edit))),
    );

  const saveChannel = useMutation({
    mutationFn: () =>
      api.put(`templates/${templateId}/channels/${channel}`, {
        enabled: defaultDraft.enabled,
        subject: defaultDraft.subject || null,
        body: defaultDraft.body || null,
        textBody: defaultDraft.textBody || null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['template', templateId] });
      void client.invalidateQueries({ queryKey: ['templates'] });
    },
  });
  const saveTranslation = useMutation({
    mutationFn: (target: { locale: string; channel: Channel; text: Text }) =>
      api.put(`templates/${templateId}/channels/${target.channel}/translations/${target.locale}`, {
        subject: target.text.subject || null,
        body: target.text.body,
        textBody: target.text.textBody || null,
      }),
    // The saved content takes the draft's place, unless it changed while saving.
    onSuccess: async (_, target) => {
      await refresh();
      dropEdits(
        (key, edit) => key === editKey(target.locale, target.channel) && edit === target.text,
      );
    },
  });
  const markCurrent = useMutation({
    mutationFn: (target: { locale: string; channel: Channel }) =>
      api.post(
        `templates/${templateId}/channels/${target.channel}/translations/${target.locale}/mark-current`,
      ),
    onSuccess: refresh,
  });
  const saveSample = useMutation({
    mutationFn: () => api.patch(`templates/${templateId}`, { sampleData: sampleText }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['template', templateId] }),
  });

  const update = (patch: Partial<Text> & { enabled?: boolean }) => {
    if (locale) {
      setEdits((current) => ({ ...current, [editKey(locale, channel)]: { ...draft, ...patch } }));
      return;
    }
    setDrafts((current) =>
      current ? { ...current, [channel]: { ...current[channel], ...patch } } : current,
    );
  };

  const selectLocale = (next: string | null) =>
    void navigate({
      to: '/templates/$templateId',
      params: { templateId },
      search: next && next !== languages?.default ? { locale: next } : {},
      replace: true,
    });

  const template = detail.data?.template;
  const labels = FIELDS[channel];
  const defaultName = languages ? languageName(languages.default) : '';
  const name = locale ? languageName(locale) : '';
  const channelWord = CHANNEL_LABELS[channel].toLowerCase();
  const translatedIn = (l: string) => rows.filter((r) => savedTranslation(l, r.channel));
  // The template's languages: the default, those it has content in, and one being added.
  const entries: LanguageEntry[] = languages
    ? [
        { locale: languages.default, note: 'Default', attention: false },
        ...languages.supported
          .filter(
            (l) =>
              l === locale ||
              translatedIn(l).length > 0 ||
              Object.keys(edits).some((key) => key.startsWith(`${l}/`)),
          )
          .map((l) => ({ locale: l, ...languageStatus(rows, l) })),
      ]
    : [];
  const saveError = locale ? (saveTranslation.error ?? markCurrent.error) : saveChannel.error;

  const startLanguage = (next: string) => {
    const started = Object.fromEntries(
      rows
        .filter((r) => r.body?.trim())
        .map((r) => [editKey(next, r.channel), startFromDefault ? toText(r) : EMPTY_TEXT]),
    );
    setEdits((current) => ({ ...current, ...started }));
    selectLocale(next);
  };

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
                <>
                  {languages ? (
                    <LanguageMenu
                      type={template.type}
                      current={locale ?? languages.default}
                      entries={entries}
                      onSelect={selectLocale}
                      onAdd={() => setAdding(true)}
                      onRemove={
                        locale && translatedIn(locale).length > 0
                          ? () => {
                              setRemoval({
                                locale,
                                contents: translatedIn(locale).map((r) => CONTENT_NOUNS[r.channel]),
                              });
                              setConfirmRemoval(true);
                            }
                          : undefined
                      }
                    />
                  ) : null}
                  {channel === 'email' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTesting(true)}
                      disabled={!stored.body}
                    >
                      <Send /> Send test
                    </Button>
                  ) : null}
                </>
              }
            />
            <Tabs value={channel} onValueChange={(value) => setChannel(value as Channel)}>
              <TabsList variant="line" className="w-full justify-start border-b">
                {(['email', 'in_app', 'push'] as Channel[]).map((key) => {
                  const tabRow = rowOf(key);
                  return (
                    <TabsTrigger key={key} value={key} className="flex-none px-3">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          drafts[key].enabled ? 'bg-success' : 'bg-muted-foreground/40',
                        )}
                      />
                      {CHANNEL_LABELS[key]}
                      <TabSuffix
                        unsaved={unsaved(key)}
                        status={
                          locale && tabRow && channelSends(tabRow) ? statusIn(tabRow, locale) : null
                        }
                      />
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="grid content-start gap-4">
                <Panel>
                  <PanelHeader
                    title={
                      locale
                        ? `${CHANNEL_LABELS[channel]} content · ${name}`
                        : `${CHANNEL_LABELS[channel]} content`
                    }
                    description={
                      locale
                        ? `Turn the channel on or off in ${defaultName}, the default language.`
                        : 'Liquid tags such as {{ amount }} read the payload of each send.'
                    }
                    actions={
                      locale ? (
                        defaultDraft.enabled ? (
                          <Pill tone="success">On</Pill>
                        ) : (
                          <Pill tone="neutral">Off</Pill>
                        )
                      ) : (
                        <div className="flex items-center gap-2">
                          <Label htmlFor="channel-enabled" className="font-normal text-xs">
                            {defaultDraft.enabled ? 'Enabled' : 'Disabled'}
                          </Label>
                          <Switch
                            id="channel-enabled"
                            checked={defaultDraft.enabled}
                            onCheckedChange={(enabled) => update({ enabled })}
                          />
                        </div>
                      )
                    }
                  />
                  {locale && missing ? (
                    <Empty className="md:py-10">
                      <EmptyHeader className="max-w-md">
                        <EmptyMedia variant="icon">
                          <Languages />
                        </EmptyMedia>
                        <EmptyTitle>
                          No {name} {channelWord} content yet
                        </EmptyTitle>
                        <EmptyDescription>
                          {name} contacts get the {defaultName} {CONTENT_ON_TAB[channel]} until you
                          add this one.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent className="flex-row justify-center">
                        <Button
                          size="sm"
                          disabled={!row?.body}
                          onClick={() => row && update(toText(row))}
                        >
                          <Copy /> Start from {defaultName}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => update(EMPTY_TEXT)}>
                          Start empty
                        </Button>
                      </EmptyContent>
                    </Empty>
                  ) : (
                    <>
                      <div className="grid gap-4 p-4">
                        {locale && translation?.status === 'outdated' ? (
                          <Alert>
                            <Info />
                            <div className="col-start-2 flex items-center justify-between gap-3">
                              <AlertTitle>
                                The {defaultName} {CONTENT_ON_TAB[channel]} changed after this
                                translation
                              </AlertTitle>
                              <Button
                                variant="outline"
                                size="xs"
                                disabled={markCurrent.isPending}
                                onClick={() => markCurrent.mutate({ locale, channel })}
                              >
                                Mark as up to date
                              </Button>
                            </div>
                            <AlertDescription>
                              {row
                                ? `${defaultName} was saved on ${formatDay(row.updatedAt)} and ${name} on ${formatDay(translation.updatedAt)}. Review this version, then save it to mark it up to date.`
                                : null}
                            </AlertDescription>
                          </Alert>
                        ) : null}
                        <div className="grid gap-2">
                          <Label htmlFor="field-subject">{labels.subject}</Label>
                          <Input
                            id="field-subject"
                            value={draft.subject}
                            onChange={(event) => update({ subject: event.target.value })}
                          />
                          <PlainTextNotice
                            channel={channel}
                            field="subject"
                            value={draft.subject}
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
                          <PlainTextNotice channel={channel} field="body" value={draft.body} />
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
                          <PlainTextNotice
                            channel={channel}
                            field="textBody"
                            value={draft.textBody}
                          />
                        </div>
                        {saveError ? <ErrorAlert error={saveError} /> : null}
                      </div>
                      <footer className="flex items-center justify-end gap-2 border-t bg-muted/30 px-4 py-2.5">
                        {dirty ? (
                          <span className="mr-auto text-muted-foreground text-xs">
                            Unsaved changes
                          </span>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!dirty}
                          onClick={() =>
                            locale
                              ? dropEdits((key) => key === editKey(locale, channel))
                              : update(stored)
                          }
                        >
                          Discard changes
                        </Button>
                        <Button
                          size="sm"
                          disabled={!dirty || saveChannel.isPending || saveTranslation.isPending}
                          onClick={() =>
                            locale && text
                              ? saveTranslation.mutate({ locale, channel, text })
                              : saveChannel.mutate()
                          }
                        >
                          {locale
                            ? `Save ${name} ${channelWord}`
                            : `Save ${CHANNEL_LABELS[channel]}`}
                        </Button>
                      </footer>
                    </>
                  )}
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
                  description={previewDescription(
                    channel,
                    locale ? { name, defaultName, missing } : null,
                  )}
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
                      <EmailPreview
                        templateId={templateId}
                        content={text ?? (row ? toText(row) : EMPTY_TEXT)}
                        locale={text ? (locale ?? undefined) : undefined}
                        sample={sample}
                      />
                    </>
                  ) : !(text ? text.body : row?.body) ? (
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
        <>
          <SendTestDialog
            templateId={templateId}
            sample={sample ?? {}}
            locale={locale}
            language={
              locale
                ? { name, defaultName, translated: Boolean(savedTranslation(locale, 'email')) }
                : null
            }
            open={testing}
            onOpenChange={setTesting}
          />
          <LanguageDialog
            open={adding}
            onOpenChange={(open) => {
              setAdding(open);
              if (open) setStartFromDefault(true);
            }}
            title="Add a language"
            description={(chosen) =>
              chosen
                ? `${template.type} gets ${chosen} content for each of its channels.`
                : `${template.type} gets content in a new language for each of its channels.`
            }
            choices={(languages?.supported ?? []).filter(
              (l) => !entries.some((entry) => entry.locale === l),
            )}
            hint="Only this Worker’s languages are listed. Add another under Channels."
            action={(chosen) => (chosen ? `Add ${chosen}` : 'Add language')}
            onSubmit={startLanguage}
          >
            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
              <div className="grid gap-0.5">
                <Label htmlFor="start-from-default">Start from the {defaultName} content</Label>
                <p className="text-muted-foreground text-xs">
                  Each channel opens with the {defaultName} text, ready to translate.
                </p>
              </div>
              <Switch
                id="start-from-default"
                checked={startFromDefault}
                onCheckedChange={setStartFromDefault}
              />
            </div>
          </LanguageDialog>
          <ConfirmDialog
            open={confirmRemoval}
            onOpenChange={setConfirmRemoval}
            title={`Remove ${languageName(removal?.locale ?? '')} from ${template.type}?`}
            description={
              removal
                ? `Its ${languageName(removal.locale)} ${listOf(removal.contents)} ${removal.contents.length === 1 ? 'is' : 'are'} deleted. ${languageName(removal.locale)} contacts get the ${defaultName} content from the next send.`
                : ''
            }
            action={`Remove ${languageName(removal?.locale ?? '')}`}
            onConfirm={async () => {
              if (!removal) return;
              await api.delete(`templates/${templateId}/translations/${removal.locale}`);
              dropEdits((key) => key.startsWith(`${removal.locale}/`));
              selectLocale(null);
              await refresh();
            }}
          />
        </>
      ) : null}
    </>
  );
};
