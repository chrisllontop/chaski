import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
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
import { ApiError, api } from '~/lib/api';

export const TemplateDetailsDialog = ({
  templateId,
  type,
  description: storedDescription,
  topic: storedTopic,
  open,
  onOpenChange,
}: {
  templateId: string;
  type: string;
  description: string | null;
  topic: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const uid = useId().replace(/:/g, '');
  const client = useQueryClient();
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');

  useEffect(() => {
    if (!open) return;
    setDescription(storedDescription ?? '');
    setTopic(storedTopic ?? '');
  }, [open, storedDescription, storedTopic]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`templates/${templateId}`, {
        description: description.trim() || null,
        topic: topic.trim() || null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['template', templateId] });
      void client.invalidateQueries({ queryKey: ['templates'] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        save.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Template details</DialogTitle>
            <DialogDescription>
              Description and topic show on the templates list.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-type`}>Type</Label>
            <div className="relative">
              <Input
                id={`${uid}-type`}
                value={type}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                className="cursor-not-allowed bg-muted/60 pr-9 font-mono text-muted-foreground"
              />
              <Lock
                className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-description`}>Description</Label>
            <Input
              id={`${uid}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={512}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-topic`}>Topic</Label>
            <Input
              id={`${uid}-topic`}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="billing"
              maxLength={128}
            />
            <p className="text-muted-foreground text-xs">
              Groups types on a contact’s preferences screen.
            </p>
          </div>
          {save.error ? (
            <p className="text-destructive text-sm">
              {save.error instanceof ApiError
                ? save.error.message
                : 'We couldn’t save your changes. Please try again.'}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
