import { type ReactNode, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { ApiError } from '~/lib/api';
import { languageName } from '~/lib/locales';

/** A language by name, with its tag beside it: `Spanish es`. */
export const LanguageLabel = ({ locale }: { locale: string }) => (
  <span className="inline-flex items-baseline gap-1.5">
    {languageName(locale)}
    <span className="font-mono text-muted-foreground text-xs">{locale}</span>
  </span>
);

/**
 * A dialog that picks one language and acts on it: adding one to the Worker or to a template,
 * or making one the default. It stays open while the action runs and shows why it failed.
 */
export const LanguageDialog = ({
  open,
  onOpenChange,
  title,
  description,
  choices,
  hint,
  action,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Static, or for the chosen language's name. */
  description: ReactNode | ((name: string | null) => ReactNode);
  choices: string[];
  hint: ReactNode;
  /** The submit label for the chosen language's name, or for none yet. */
  action: (name: string | null) => string;
  /** May return a promise: the dialog closes once it resolves. */
  onSubmit: (locale: string) => unknown;
  children?: ReactNode;
}) => {
  const [locale, setLocale] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const chosen = locale !== null && choices.includes(locale) ? locale : null;
  const chosenName = chosen ? languageName(chosen) : null;

  const submit = async () => {
    if (!chosen) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(chosen);
      setLocale(null);
      onOpenChange(false);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(null);
        if (!next) setLocale(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {typeof description === 'function' ? description(chosenName) : description}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor="language-choice">Language</Label>
            <Select value={chosen ?? ''} onValueChange={setLocale} disabled={choices.length === 0}>
              <SelectTrigger id="language-choice" className="w-full">
                <SelectValue placeholder="Choose a language" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {choices.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    <LanguageLabel locale={choice} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-pretty text-muted-foreground text-xs">{hint}</p>
          </div>
          {children}
          {error ? (
            <p className="text-pretty text-destructive text-sm">
              {error instanceof ApiError
                ? error.message
                : 'We couldn’t save this language. Please try again.'}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!chosen || pending}>
              {action(chosenName)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
