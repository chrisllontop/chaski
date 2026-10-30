import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Upload } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import { ApiError, api } from '~/lib/api';
import type {
  ApnsApp,
  ApnsSettings,
  EmailSettings,
  FcmSettings,
  VapidSettings,
  WnsSettings,
} from '~/lib/types';

// Every form starts from what's saved each time its dialog opens: the dialog unmounts its content
// on close. A secret never comes back from the API, so a saved one shows as saved and the field
// only replaces it; left alone, the request leaves it out and the saved one stays.

const useSave = (save: () => Promise<unknown>, onSaved: () => void) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['channels'] });
      onSaved();
    },
  });
};

const Field = ({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <div className="grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint ? <p className="text-pretty text-muted-foreground text-xs">{hint}</p> : null}
  </div>
);

const UploadButton = ({
  label,
  accept,
  onLoad,
}: {
  label: string;
  accept: string;
  onLoad: (text: string) => void;
}) => (
  <Button type="button" variant="ghost" size="xs" asChild>
    <label className="cursor-pointer">
      <Upload /> {label}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) onLoad(await file.text());
          event.target.value = '';
        }}
      />
    </label>
  </Button>
);

const SecretField = ({
  id,
  label,
  saved,
  value,
  onChange,
  upload,
  hint,
}: {
  id: string;
  label: string;
  saved: boolean;
  value: string;
  onChange: (value: string) => void;
  /** A key file to read instead of pasting it; without one the secret is a single line. */
  upload?: { label: string; accept: string };
  hint?: ReactNode;
}) => {
  const [replacing, setReplacing] = useState(!saved);
  if (!replacing) {
    return (
      <div className="grid gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5">
          <span className="flex items-center gap-2 text-muted-foreground text-sm">
            <KeyRound className="size-4" /> Saved
          </span>
          <Button
            id={id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReplacing(true)}
          >
            Replace
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-1">
          {upload ? <UploadButton {...upload} onLoad={onChange} /> : null}
          {saved ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                onChange('');
                setReplacing(false);
              }}
            >
              Keep the saved one
            </Button>
          ) : null}
        </div>
      </div>
      {upload ? (
        <Textarea
          id={id}
          required={!saved}
          rows={5}
          spellCheck={false}
          className="font-mono text-xs"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          type="password"
          required={!saved}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <p className="text-pretty text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
};

/** The fields of a secret, only when someone typed or uploaded one. */
const secret = <K extends string>(key: K, value: string) =>
  (value.trim() ? { [key]: value } : {}) as Partial<Record<K, string>>;

const SettingsForm = ({
  title,
  description,
  error,
  pending,
  onSubmit,
  onCancel,
  onRemove,
  removeLabel,
  children,
}: {
  title: string;
  description: ReactNode;
  error: unknown;
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  /** Shown once the section is saved. */
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}) => (
  <form
    className="grid gap-4"
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
    {children}
    {error ? (
      <p className="text-pretty text-destructive text-sm">
        {error instanceof ApiError
          ? error.message
          : 'We couldn’t save these settings. Please try again.'}
      </p>
    ) : null}
    <DialogFooter>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive sm:mr-auto"
          onClick={onRemove}
        >
          {removeLabel}
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </DialogFooter>
  </form>
);

type DialogProps<T> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: T | null;
  /** Closes this dialog and asks to remove the section. */
  onRemove: () => void;
};

const SettingsDialog = ({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{children}</DialogContent>
  </Dialog>
);

// ─── Email ───

const EmailForm = ({
  settings,
  onOpenChange,
  onRemove,
}: Omit<DialogProps<EmailSettings>, 'open'>) => {
  const [from, setFrom] = useState(settings?.from ?? '');
  const [fromName, setFromName] = useState(settings?.fromName ?? '');
  const [replyTo, setReplyTo] = useState(settings?.replyTo ?? '');
  const save = useSave(
    () => api.put('channels/email', { from, fromName, replyTo }),
    () => onOpenChange(false),
  );
  return (
    <SettingsForm
      title={settings ? 'Edit email' : 'Set up email'}
      description="Notifications go out from this address through the CHASKI_EMAIL binding."
      error={save.error}
      pending={save.isPending}
      onSubmit={() => save.mutate()}
      onCancel={() => onOpenChange(false)}
      onRemove={settings ? onRemove : undefined}
      removeLabel="Remove email"
    >
      <Field
        id="email-from"
        label="From"
        hint="Use an address the send_email binding in wrangler.jsonc allows."
      >
        <Input
          id="email-from"
          type="email"
          required
          placeholder="notifications@example.com"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </Field>
      <Field id="email-from-name" label="From name">
        <Input
          id="email-from-name"
          placeholder="Acme"
          value={fromName}
          onChange={(event) => setFromName(event.target.value)}
        />
      </Field>
      <Field id="email-reply-to" label="Reply-to">
        <Input
          id="email-reply-to"
          type="email"
          placeholder="support@example.com"
          value={replyTo}
          onChange={(event) => setReplyTo(event.target.value)}
        />
      </Field>
    </SettingsForm>
  );
};

export const EmailDialog = ({ open, ...props }: DialogProps<EmailSettings>) => (
  <SettingsDialog open={open} onOpenChange={props.onOpenChange}>
    <EmailForm {...props} />
  </SettingsDialog>
);

// ─── Web push ───

const VapidForm = ({
  settings,
  onOpenChange,
  onRemove,
}: Omit<DialogProps<VapidSettings>, 'open'>) => {
  const [subject, setSubject] = useState(settings?.subject ?? '');
  // Saved keys stay unless someone chooses to replace them.
  const [replacing, setReplacing] = useState(!settings);
  const [source, setSource] = useState<'generate' | 'paste'>('generate');
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [confirming, setConfirming] = useState(false);
  const replace = Boolean(settings);
  const save = useSave(
    () => {
      if (!replacing) return api.put('channels/push/vapid', { subject });
      if (source === 'generate') {
        return api.post('channels/push/vapid/generate', { subject, replace });
      }
      return api.put('channels/push/vapid', { subject, publicKey, privateKey, replace });
    },
    () => onOpenChange(false),
  );
  return (
    <>
      <SettingsForm
        title={settings ? 'Edit web push' : 'Set up web push'}
        description="Browsers subscribe with the public key, and push services check each push against it."
        error={save.error}
        pending={save.isPending}
        onSubmit={() => (settings && replacing ? setConfirming(true) : save.mutate())}
        onCancel={() => onOpenChange(false)}
        onRemove={settings ? onRemove : undefined}
        removeLabel="Remove web push"
      >
        <Field
          id="vapid-subject"
          label="Contact"
          hint="A mailto: or https: address push services can reach you at."
        >
          <Input
            id="vapid-subject"
            required
            placeholder="mailto:ops@example.com"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>
        {replacing ? (
          <Tabs value={source} onValueChange={(value) => setSource(value as typeof source)}>
            <div className="flex items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="generate">Generate keys</TabsTrigger>
                <TabsTrigger value="paste">Use existing keys</TabsTrigger>
              </TabsList>
              {settings ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => setReplacing(false)}>
                  Keep the saved keys
                </Button>
              ) : null}
            </div>
            <TabsContent value="generate">
              <p className="text-pretty text-muted-foreground text-sm">
                Chaski makes a new key pair and stores the private key encrypted.
              </p>
            </TabsContent>
            <TabsContent value="paste" className="grid gap-4">
              <Field id="vapid-public" label="Public key">
                <Input
                  id="vapid-public"
                  required={source === 'paste'}
                  spellCheck={false}
                  className="font-mono text-xs"
                  value={publicKey}
                  onChange={(event) => setPublicKey(event.target.value)}
                />
              </Field>
              <SecretField
                id="vapid-private"
                label="Private key"
                saved={false}
                value={privateKey}
                onChange={setPrivateKey}
                hint="Both keys in base64url, as web-push tools print them."
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="vapid-replace">Keys</Label>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5">
              <code className="min-w-0 truncate font-mono text-muted-foreground text-xs">
                {settings?.publicKey}
              </code>
              <Button
                id="vapid-replace"
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReplacing(true)}
              >
                Replace keys
              </Button>
            </div>
          </div>
        )}
      </SettingsForm>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the web push keys?</AlertDialogTitle>
            <AlertDialogDescription>
              Browsers subscribed with the current public key stop receiving push until they
              subscribe again with the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                save.mutate();
              }}
            >
              Replace keys
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export const VapidDialog = ({ open, ...props }: DialogProps<VapidSettings>) => (
  <SettingsDialog open={open} onOpenChange={props.onOpenChange}>
    <VapidForm {...props} />
  </SettingsDialog>
);

// ─── APNs ───

const ENVIRONMENTS = { sandbox: 'Sandbox', production: 'Production' } as const;

const AppFields = ({
  id,
  label,
  app,
  onChange,
}: {
  id: string;
  label: string;
  app: ApnsApp | null;
  onChange: (app: ApnsApp | null) => void;
}) => (
  <div className="grid gap-3 rounded-md border p-3">
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={`${id}-on`}>{label}</Label>
      <Switch
        id={`${id}-on`}
        checked={app !== null}
        onCheckedChange={(on) => onChange(on ? { bundleId: '', environment: 'production' } : null)}
      />
    </div>
    {app ? (
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field id={`${id}-bundle`} label="Bundle ID">
          <Input
            id={`${id}-bundle`}
            required
            placeholder="com.example.app"
            value={app.bundleId}
            onChange={(event) => onChange({ ...app, bundleId: event.target.value })}
          />
        </Field>
        <Field id={`${id}-environment`} label="Environment">
          <Select
            value={app.environment}
            onValueChange={(environment) =>
              onChange({ ...app, environment: environment as ApnsApp['environment'] })
            }
          >
            <SelectTrigger id={`${id}-environment`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ENVIRONMENTS).map(([value, name]) => (
                <SelectItem key={value} value={value}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    ) : null}
  </div>
);

const ApnsForm = ({
  settings,
  onOpenChange,
  onRemove,
}: Omit<DialogProps<ApnsSettings>, 'open'>) => {
  const [teamId, setTeamId] = useState(settings?.teamId ?? '');
  const [keyId, setKeyId] = useState(settings?.keyId ?? '');
  const [privateKey, setPrivateKey] = useState('');
  const [ios, setIos] = useState<ApnsApp | null>(settings?.ios ?? null);
  const [macos, setMacos] = useState<ApnsApp | null>(settings?.macos ?? null);
  const save = useSave(
    () =>
      api.put('channels/push/apns', {
        teamId,
        keyId,
        ios,
        macos,
        ...secret('privateKey', privateKey),
      }),
    () => onOpenChange(false),
  );
  return (
    <SettingsForm
      title={settings ? 'Edit APNs' : 'Set up APNs'}
      description="One key from your Apple Developer account sends to the iOS and macOS apps of its team."
      error={save.error}
      pending={save.isPending}
      onSubmit={() => save.mutate()}
      onCancel={() => onOpenChange(false)}
      onRemove={settings ? onRemove : undefined}
      removeLabel="Remove APNs"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="apns-team" label="Team ID">
          <Input
            id="apns-team"
            required
            spellCheck={false}
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          />
        </Field>
        <Field id="apns-key-id" label="Key ID">
          <Input
            id="apns-key-id"
            required
            spellCheck={false}
            value={keyId}
            onChange={(event) => setKeyId(event.target.value)}
          />
        </Field>
      </div>
      <SecretField
        id="apns-key"
        label="Private key (.p8)"
        saved={settings?.privateKeySet ?? false}
        value={privateKey}
        onChange={setPrivateKey}
        upload={{ label: 'Upload .p8', accept: '.p8' }}
      />
      <AppFields id="apns-ios" label="iOS app" app={ios} onChange={setIos} />
      <AppFields id="apns-macos" label="macOS app" app={macos} onChange={setMacos} />
      <p className="text-pretty text-muted-foreground text-xs">
        Development builds get sandbox tokens; TestFlight and App Store builds get production ones.
      </p>
    </SettingsForm>
  );
};

export const ApnsDialog = ({ open, ...props }: DialogProps<ApnsSettings>) => (
  <SettingsDialog open={open} onOpenChange={props.onOpenChange}>
    <ApnsForm {...props} />
  </SettingsDialog>
);

// ─── FCM ───

const FcmForm = ({ settings, onOpenChange, onRemove }: Omit<DialogProps<FcmSettings>, 'open'>) => {
  const [serviceAccount, setServiceAccount] = useState('');
  const save = useSave(
    () => api.put('channels/push/fcm', secret('serviceAccount', serviceAccount)),
    () => onOpenChange(false),
  );
  return (
    <SettingsForm
      title={settings ? 'Edit FCM' : 'Set up FCM'}
      description="Firebase Cloud Messaging reaches Android devices through a service account of your Firebase project."
      error={save.error}
      pending={save.isPending}
      onSubmit={() => save.mutate()}
      onCancel={() => onOpenChange(false)}
      onRemove={settings ? onRemove : undefined}
      removeLabel="Remove FCM"
    >
      {settings?.projectId ? (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Project</dt>
          <dd className="min-w-0 wrap-anywhere">{settings.projectId}</dd>
          <dt className="text-muted-foreground">Account</dt>
          <dd className="min-w-0 wrap-anywhere">{settings.clientEmail}</dd>
        </dl>
      ) : null}
      <SecretField
        id="fcm-account"
        label="Service account key"
        saved={settings?.serviceAccountSet ?? false}
        value={serviceAccount}
        onChange={setServiceAccount}
        upload={{ label: 'Upload JSON', accept: '.json,application/json' }}
        hint="The JSON key file from Project settings › Service accounts in the Firebase console."
      />
    </SettingsForm>
  );
};

export const FcmDialog = ({ open, ...props }: DialogProps<FcmSettings>) => (
  <SettingsDialog open={open} onOpenChange={props.onOpenChange}>
    <FcmForm {...props} />
  </SettingsDialog>
);

// ─── WNS ───

const WnsForm = ({ settings, onOpenChange, onRemove }: Omit<DialogProps<WnsSettings>, 'open'>) => {
  const [tenantId, setTenantId] = useState(settings?.tenantId ?? '');
  const [clientId, setClientId] = useState(settings?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const save = useSave(
    () =>
      api.put('channels/push/wns', { tenantId, clientId, ...secret('clientSecret', clientSecret) }),
    () => onOpenChange(false),
  );
  return (
    <SettingsForm
      title={settings ? 'Edit WNS' : 'Set up WNS'}
      description="Windows apps get push through the Microsoft Entra app registration they create their push channel with."
      error={save.error}
      pending={save.isPending}
      onSubmit={() => save.mutate()}
      onCancel={() => onOpenChange(false)}
      onRemove={settings ? onRemove : undefined}
      removeLabel="Remove WNS"
    >
      <Field id="wns-tenant" label="Directory (tenant) ID">
        <Input
          id="wns-tenant"
          required
          spellCheck={false}
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
        />
      </Field>
      <Field id="wns-client" label="Application (client) ID">
        <Input
          id="wns-client"
          required
          spellCheck={false}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
      </Field>
      <SecretField
        id="wns-secret"
        label="Client secret"
        saved={settings?.clientSecretSet ?? false}
        value={clientSecret}
        onChange={setClientSecret}
      />
    </SettingsForm>
  );
};

export const WnsDialog = ({ open, ...props }: DialogProps<WnsSettings>) => (
  <SettingsDialog open={open} onOpenChange={props.onOpenChange}>
    <WnsForm {...props} />
  </SettingsDialog>
);

// ─── Muted by default ───

const MutedTypesForm = ({
  mutedTypes,
  onOpenChange,
}: {
  mutedTypes: string[];
  onOpenChange: (open: boolean) => void;
}) => {
  const [text, setText] = useState(mutedTypes.join('\n'));
  const save = useSave(
    () =>
      api.put('preferences/defaults', {
        mutedTypes: text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    () => onOpenChange(false),
  );
  return (
    <SettingsForm
      title="Muted by default"
      description="Every contact has these types muted until they save preferences of their own."
      error={save.error}
      pending={save.isPending}
      onSubmit={() => save.mutate()}
      onCancel={() => onOpenChange(false)}
    >
      <Field
        id="muted-types"
        label="Types"
        hint="One per line. End with * to match a prefix, as in marketing.*, or start with a channel to mute it there only, as in push:digest."
      >
        <Textarea
          id="muted-types"
          rows={6}
          spellCheck={false}
          className="font-mono text-xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
    </SettingsForm>
  );
};

export const MutedTypesDialog = ({
  open,
  onOpenChange,
  mutedTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mutedTypes: string[];
}) => (
  <SettingsDialog open={open} onOpenChange={onOpenChange}>
    <MutedTypesForm mutedTypes={mutedTypes} onOpenChange={onOpenChange} />
  </SettingsDialog>
);
