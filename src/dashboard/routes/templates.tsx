import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import { Download, FileText, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import {
  DataBody,
  DataCell,
  DataEmpty,
  DataHead,
  DataHeader,
  DataRow,
  DataTable,
  rowActionClass,
} from '~/components/app/data-table';
import { CHANNEL_ICONS, HealthBadge } from '~/components/app/delivery-bits';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { Pill, type Tone } from '~/components/app/pill';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { ApiError, api } from '~/lib/api';
import { CHANNEL_LABELS, formatDateTime, formatNumber, formatRelative } from '~/lib/format';
import { healthByType } from '~/lib/health';
import type {
  Channel,
  DeletedTemplate,
  Health,
  TemplateChange,
  TemplateSummary,
  TypeOutcome,
} from '~/lib/types';

const CHANNELS: Channel[] = ['email', 'in_app', 'push'];

const ChannelIcons = ({ channels }: { channels: TemplateSummary['channels'] }) => (
  <div className="flex items-center gap-1">
    {CHANNELS.map((channel) => {
      const Icon = CHANNEL_ICONS[channel];
      const enabled = channels.some((c) => c.channel === channel && c.enabled);
      return (
        <span
          key={channel}
          title={`${CHANNEL_LABELS[channel]} ${enabled ? 'on' : 'off'}`}
          className={cn(
            'flex size-6 items-center justify-center rounded-md',
            enabled ? 'bg-muted text-foreground' : 'text-muted-foreground/40',
          )}
        >
          <Icon
            aria-label={`${CHANNEL_LABELS[channel]} ${enabled ? 'on' : 'off'}`}
            className="size-3.5"
          />
        </span>
      );
    })}
  </div>
);

const Tag = ({ children }: { children: string }) => (
  <span className="inline-flex h-5 items-center rounded-md border px-1.5 text-muted-foreground text-xs">
    {children}
  </span>
);

const Dash = () => <span className="text-muted-foreground">–</span>;

const When = ({ at }: { at: string | null }) =>
  at ? (
    <time dateTime={at} title={formatDateTime(at)}>
      {formatRelative(at)}
    </time>
  ) : (
    <Dash />
  );

// ─── New template ───

const NewTemplateDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post<{ template: { id: string } }>('templates', {
        type: type.trim(),
        description: description.trim() || null,
        topic: topic.trim() || null,
      }),
    onSuccess: ({ template }) => {
      void client.invalidateQueries({ queryKey: ['templates'] });
      onOpenChange(false);
      void navigate({ to: '/templates/$templateId', params: { templateId: template.id } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              A template holds the content of one notification type. Sends of that type render it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="template-type">Type</Label>
            <Input
              id="template-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="payment_received"
              className="font-mono"
              required
              pattern="[A-Za-z0-9_.\-]+"
            />
            <p className="text-muted-foreground text-xs">
              Letters, digits, dots, dashes and underscores.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="template-description">Description</Label>
            <Input
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="template-topic">Topic</Label>
            <Input
              id="template-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="billing"
            />
            <p className="text-muted-foreground text-xs">
              Groups types on a contact’s preferences screen.
            </p>
          </div>
          {create.error ? (
            <p className="text-destructive text-sm">
              {create.error instanceof ApiError
                ? create.error.message
                : 'Something went wrong. Try again.'}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !type.trim()}>
              Create template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ─── Import ───

const CHANGE: Record<TemplateChange['change'], { label: string; tone: Tone }> = {
  create: { label: 'Create', tone: 'success' },
  update: { label: 'Update', tone: 'info' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
};

const ImportDialog = ({
  file,
  onClose,
}: {
  file: { name: string; content: unknown } | null;
  onClose: () => void;
}) => {
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ['templates', 'import-preview', file?.name, file?.content],
    queryFn: () =>
      api.post<{ changes: TemplateChange[] }>('templates/import?preview=true', file?.content),
    enabled: file !== null,
    retry: false,
  });
  const apply = useMutation({
    mutationFn: () => api.post('templates/import', file?.content),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    },
  });
  const changes = preview.data?.changes ?? [];
  const count = changes.filter((change) => change.change !== 'unchanged').length;
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import templates</DialogTitle>
          <DialogDescription>
            {file?.name}. Templates are matched by type; channels the file leaves out keep their
            content.
          </DialogDescription>
        </DialogHeader>
        {preview.error ? <ErrorAlert error={preview.error} /> : null}
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border text-[13px]">
          {changes.map((change) => (
            <li key={change.type} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="font-mono text-xs">{change.type}</div>
                {change.fields.length > 0 ? (
                  <div className="text-muted-foreground text-xs">
                    Overwrites {change.fields.join(', ')}
                  </div>
                ) : null}
                {change.warnings.map((warning) => (
                  <div key={warning.field} className="text-warning text-xs">
                    {warning.field} is plain text: {warning.entities.join(', ')} will appear as
                    typed
                  </div>
                ))}
              </div>
              <Pill tone={CHANGE[change.change].tone}>{CHANGE[change.change].label}</Pill>
            </li>
          ))}
        </ul>
        {apply.error ? <ErrorAlert error={apply.error} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={count === 0 || apply.isPending} onClick={() => apply.mutate()}>
            {count === 0
              ? 'Nothing to import'
              : `Import ${formatNumber(count)} ${count === 1 ? 'change' : 'changes'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Page ───

const TypeHealth = ({ health }: { health: Health | undefined }) =>
  health ? (
    <HealthBadge health={health} />
  ) : (
    <span className="text-muted-foreground">No sends</span>
  );

export const TemplatesPage = () => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<{ name: string; content: unknown } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const [purging, setPurging] = useState<DeletedTemplate | null>(null);

  const live = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: TemplateSummary[] }>('templates'),
  });
  const deleted = useQuery({
    queryKey: ['templates', 'deleted'],
    queryFn: () => api.get<{ templates: DeletedTemplate[] }>('templates/deleted'),
  });
  // Same key as the overview's 30-day query, so the two share one fetch.
  const outcomes = useQuery({
    queryKey: ['metrics', 'types', '30d'],
    queryFn: () => api.get<{ types: TypeOutcome[] }>('metrics/types?period=30d'),
  });
  const health = healthByType(outcomes.data?.types ?? []);
  const refresh = () => client.invalidateQueries({ queryKey: ['templates'] });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api.delete(`templates/${id}`),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`templates/${id}/restore`),
    onSuccess: refresh,
  });
  const purge = useMutation({
    mutationFn: (id: string) => api.delete(`templates/${id}/permanent`),
    onSuccess: refresh,
  });

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setImportError(null);
      setImporting({ name: file.name, content: JSON.parse(await file.text()) });
    } catch {
      setImportError(`${file.name} isn’t a JSON file.`);
    }
  };

  const templates = live.data?.templates ?? [];
  const actions = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={readFile}
      />
      <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
        <Upload /> Import
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href={api.url('templates/export')} download>
          <Download /> Export
        </a>
      </Button>
      <Button size="sm" onClick={() => setCreating(true)}>
        <Plus /> New template
      </Button>
    </>
  );

  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 pt-6 pb-10">
        <PageHeader
          title="Templates"
          description="The content of every notification type"
          actions={actions}
        />
        {importError ? <p className="text-destructive text-sm">{importError}</p> : null}
        {live.error ? <ErrorAlert error={live.error} /> : null}

        {live.data && templates.length === 0 && (deleted.data?.templates.length ?? 0) === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>No templates yet</EmptyTitle>
              <EmptyDescription>
                Sends need a template for their type. Create one, or import a file exported from
                another environment.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button onClick={() => setCreating(true)}>
                <Plus /> New template
              </Button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <Upload /> Import
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Tabs defaultValue="active" className="gap-4">
            <TabsList variant="line" className="w-full justify-start border-b">
              <TabsTrigger value="active" className="flex-none px-3">
                Active
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatNumber(templates.length)}
                </span>
              </TabsTrigger>
              <TabsTrigger value="deleted" className="flex-none px-3">
                Deleted
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatNumber(deleted.data?.templates.length ?? 0)}
                </span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="active">
              <DataTable>
                <DataHeader>
                  <DataRow>
                    <DataHead>Type</DataHead>
                    <DataHead>Topic</DataHead>
                    <DataHead>Channels</DataHead>
                    <DataHead>Health · 30 days</DataHead>
                    <DataHead numeric>Updated</DataHead>
                    <DataHead numeric>Last used</DataHead>
                    <DataHead className="w-10" />
                  </DataRow>
                </DataHeader>
                <DataBody>
                  {!live.data ? (
                    <DataEmpty colSpan={7}>
                      <Skeleton className="mx-auto h-4 w-48" />
                    </DataEmpty>
                  ) : templates.length === 0 ? (
                    <DataEmpty colSpan={7}>Every template is deleted.</DataEmpty>
                  ) : (
                    templates.map((template) => (
                      <DataRow
                        key={template.id}
                        className="cursor-pointer"
                        onClick={() =>
                          void navigate({
                            to: '/templates/$templateId',
                            params: { templateId: template.id },
                          })
                        }
                      >
                        <DataCell>
                          <div className="font-medium font-mono text-xs">{template.type}</div>
                          {template.description ? (
                            <div className="text-muted-foreground text-xs">
                              {template.description}
                            </div>
                          ) : null}
                        </DataCell>
                        <DataCell>
                          {template.topic ? <Tag>{template.topic}</Tag> : <Dash />}
                        </DataCell>
                        <DataCell>
                          <ChannelIcons channels={template.channels} />
                        </DataCell>
                        <DataCell>
                          <TypeHealth health={health.get(template.type)} />
                        </DataCell>
                        <DataCell numeric className="text-muted-foreground">
                          <When at={template.contentUpdatedAt} />
                        </DataCell>
                        <DataCell numeric className="text-muted-foreground">
                          <When at={template.lastUsedAt} />
                        </DataCell>
                        <DataCell onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`size-7 text-muted-foreground ${rowActionClass}`}
                              >
                                <MoreHorizontal />
                                <span className="sr-only">Actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link
                                  to="/templates/$templateId"
                                  params={{ templateId: template.id }}
                                >
                                  Edit template
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeleting(template)}
                              >
                                Delete template
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </DataCell>
                      </DataRow>
                    ))
                  )}
                </DataBody>
              </DataTable>
            </TabsContent>
            <TabsContent value="deleted" className="space-y-4">
              <DataTable>
                <DataHeader>
                  <DataRow>
                    <DataHead>Type</DataHead>
                    <DataHead>Topic</DataHead>
                    <DataHead numeric>Deleted</DataHead>
                    <DataHead className="w-64" />
                  </DataRow>
                </DataHeader>
                <DataBody>
                  {(deleted.data?.templates ?? []).length === 0 ? (
                    <DataEmpty colSpan={4}>No deleted templates.</DataEmpty>
                  ) : (
                    deleted.data?.templates.map((template) => (
                      <DataRow key={template.id}>
                        <DataCell className="font-medium font-mono text-xs">
                          {template.type}
                        </DataCell>
                        <DataCell>
                          {template.topic ? <Tag>{template.topic}</Tag> : <Dash />}
                        </DataCell>
                        <DataCell numeric className="text-muted-foreground">
                          <When at={template.deletedAt} />
                        </DataCell>
                        <DataCell className="space-x-1 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={restore.isPending}
                            onClick={() => restore.mutate(template.id)}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPurging(template)}
                          >
                            Delete permanently
                          </Button>
                        </DataCell>
                      </DataRow>
                    ))
                  )}
                </DataBody>
              </DataTable>
              {restore.error ? <ErrorAlert error={restore.error} /> : null}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <NewTemplateDialog open={creating} onOpenChange={setCreating} />
      <ImportDialog file={importing} onClose={() => setImporting(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.type ?? 'template'}?`}
        description={`The template moves to deleted templates. New sends of ${deleting?.type} are rejected until you restore it or create it again, and scheduled ones are skipped when they fire.`}
        action="Delete template"
        onConfirm={() => deleteTemplate.mutateAsync(deleting?.id ?? '')}
      />
      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(open) => !open && setPurging(null)}
        title={`Delete ${purging?.type ?? 'template'} permanently?`}
        description="This removes the template and the content of all its channels. It can’t be undone."
        action="Delete permanently"
        onConfirm={() => purge.mutateAsync(purging?.id ?? '')}
      />
    </>
  );
};
