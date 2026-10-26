import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Download, FileText, MoreVertical, Plus, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { ConfirmDialog } from '~/components/app/confirm-dialog';
import { CHANNEL_ICONS } from '~/components/app/delivery-bits';
import { ErrorAlert, PageHeader } from '~/components/app/page';
import { SiteHeader } from '~/components/app/site-header';
import { Badge } from '~/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { ApiError, api } from '~/lib/api';
import { CHANNEL_LABELS, formatDateTime, formatNumber } from '~/lib/format';
import type { Channel, DeletedTemplate, TemplateChange, TemplateSummary } from '~/lib/types';

const CHANNELS: Channel[] = ['email', 'in_app', 'push'];

const ChannelIcons = ({ channels }: { channels: TemplateSummary['channels'] }) => (
  <div className="flex items-center gap-2">
    {CHANNELS.map((channel) => {
      const Icon = CHANNEL_ICONS[channel];
      const enabled = channels.some((c) => c.channel === channel && c.enabled);
      return (
        <Icon
          key={channel}
          aria-label={`${CHANNEL_LABELS[channel]} ${enabled ? 'on' : 'off'}`}
          className={enabled ? 'size-4' : 'size-4 text-muted-foreground opacity-50'}
        />
      );
    })}
  </div>
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

const CHANGE_BADGE: Record<
  TemplateChange['change'],
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  create: { label: 'Create', variant: 'default' },
  update: { label: 'Update', variant: 'secondary' },
  unchanged: { label: 'Unchanged', variant: 'outline' },
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
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border text-sm">
          {changes.map((change) => (
            <li key={change.type} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="font-mono">{change.type}</div>
                {change.fields.length > 0 ? (
                  <div className="text-muted-foreground text-xs">
                    Overwrites {change.fields.join(', ')}
                  </div>
                ) : null}
              </div>
              <Badge variant={CHANGE_BADGE[change.change].variant}>
                {CHANGE_BADGE[change.change].label}
              </Badge>
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
      <Button variant="outline" onClick={() => fileInput.current?.click()}>
        <Upload /> Import
      </Button>
      <Button variant="outline" asChild>
        <a href={api.url('templates/export')} download>
          <Download /> Export
        </a>
      </Button>
      <Button onClick={() => setCreating(true)}>
        <Plus /> New template
      </Button>
    </>
  );

  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col gap-6 p-6">
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
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">
                Active <Badge variant="secondary">{formatNumber(templates.length)}</Badge>
              </TabsTrigger>
              <TabsTrigger value="deleted">
                Deleted{' '}
                <Badge variant="secondary">
                  {formatNumber(deleted.data?.templates.length ?? 0)}
                </Badge>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="active">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted">
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Topic</TableHead>
                      <TableHead>Channels</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((template) => (
                      <TableRow
                        key={template.id}
                        className="cursor-pointer"
                        onClick={() =>
                          void navigate({
                            to: '/templates/$templateId',
                            params: { templateId: template.id },
                          })
                        }
                      >
                        <TableCell>
                          <div className="font-medium font-mono">{template.type}</div>
                          {template.description ? (
                            <div className="text-muted-foreground text-xs">
                              {template.description}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {template.topic ? <Badge variant="outline">{template.topic}</Badge> : '–'}
                        </TableCell>
                        <TableCell>
                          <ChannelIcons channels={template.channels} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(template.contentUpdatedAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(template.lastUsedAt)}
                        </TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground"
                              >
                                <MoreVertical />
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
            <TabsContent value="deleted">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted">
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Topic</TableHead>
                      <TableHead>Deleted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(deleted.data?.templates ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                          No deleted templates.
                        </TableCell>
                      </TableRow>
                    ) : (
                      deleted.data?.templates.map((template) => (
                        <TableRow key={template.id}>
                          <TableCell className="font-medium font-mono">{template.type}</TableCell>
                          <TableCell>
                            {template.topic ? (
                              <Badge variant="outline">{template.topic}</Badge>
                            ) : (
                              '–'
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(template.deletedAt)}
                          </TableCell>
                          <TableCell className="space-x-2 text-right">
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
                              className="text-destructive"
                              onClick={() => setPurging(template)}
                            >
                              Delete permanently
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
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
