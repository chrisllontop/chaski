export type WnsCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

const SCOPE = 'https://wns.windows.com/.default';

// WNS refuses a toast over 5000 bytes with a 413.
export const MAX_TOAST_BYTES = 5000;

// Renewed this long before Microsoft's expiry, so a token never runs out in the
// middle of a fan-out.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

const cacheKey = (creds: Pick<WnsCredentials, 'tenantId' | 'clientId'>) =>
  `${creds.tenantId}:${creds.clientId}`;

export const clearWnsAccessToken = (creds: Pick<WnsCredentials, 'tenantId' | 'clientId'>): void => {
  tokenCache.delete(cacheKey(creds));
};

// The Windows App SDK's push takes a Microsoft Entra app's client credentials, not a Partner
// Center one's; each isolate reuses the access token they buy until it nears its expiry.
export const getWnsAccessToken = async (creds: WnsCredentials): Promise<string> => {
  const key = cacheKey(creds);
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: SCOPE,
      }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number | string;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(
      `Microsoft Entra refused the WNS client credentials (${response.status}${body.error ? ` ${body.error}` : ''})`,
    );
  }
  tokenCache.set(key, {
    token: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 - EXPIRY_MARGIN_MS,
  });
  return body.access_token;
};

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

// The Windows App SDK reads `launch` as `key=value` pairs split on `;`, with `%`, `;` and `=`
// percent-encoded, and hands them to the app as AppNotificationActivatedEventArgs.Arguments.
const encodeArgument = (value: string) =>
  value.replaceAll('%', '%25').replaceAll(';', '%3B').replaceAll('=', '%3D');

export const buildToast = (input: {
  title: string;
  body: string;
  arguments: Record<string, string>;
  silent?: boolean;
}): string => {
  const launch = Object.entries(input.arguments)
    .map(([key, value]) => `${encodeArgument(key)}=${encodeArgument(value)}`)
    .join(';');
  return [
    launch ? `<toast launch="${escapeXml(launch)}">` : '<toast>',
    '<visual><binding template="ToastGeneric">',
    `<text>${escapeXml(input.title)}</text>`,
    `<text>${escapeXml(input.body)}</text>`,
    '</binding></visual>',
    input.silent ? '<audio silent="true"/>' : '',
    '</toast>',
  ].join('');
};

export const buildWnsRequest = (input: {
  accessToken: string;
  channelUri: string;
  toast: string;
}): { url: string; headers: Record<string, string>; body: string } => ({
  url: input.channelUri,
  headers: {
    authorization: `Bearer ${input.accessToken}`,
    'content-type': 'text/xml',
    'x-wns-type': 'wns/toast',
    'x-wns-ttl': '3600',
  },
  body: input.toast,
});
