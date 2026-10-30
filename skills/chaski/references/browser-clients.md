# Add Chaski to the frontend

The frontend reaches the signed-in user’s feed, push devices and preferences through the routes
the host mounted with `chaski.userRoutes()` ([setup.md](setup.md), step 5). Three entries of the
package run in the browser, and none imports server code:

| Entry | Gives |
| --- | --- |
| `chaskijs/client` | `createChaskiClient`: the feed, unread count, live updates, push and preferences |
| `chaskijs/sw` | `handlePushEvents`, which shows web push from the service worker |
| `chaskijs/react` | `ChaskiProvider`, `useFeed`, `useUnreadCount`, `usePush`, `usePreferences`, `useFeedConnection` (React 18 or 19) |

The guide for people: https://chaski.sh/docs/browser-clients.

## 1. Survey the frontend

Write down:

- **Where it’s served**, compared with the user routes: the same origin (this Worker’s `assets`,
  or a route of the same domain), or another origin.
- **The framework and bundler**: React or not, Vite, Next.js, Astro, a plain bundle.
- **A query cache** already in use: TanStack Query, SWR.
- **An existing service worker**: a PWA plugin (`vite-plugin-pwa`, Workbox), a hand-written
  `sw.js`, a `firebase-messaging-sw.js`. Search for `serviceWorker.register` and
  `addEventListener('push'`.
- **A Content-Security-Policy** on the frontend’s pages.

**Done when** each item is named or known to be absent.

## 2. Create the client

Create it once and share it:

```ts
// src/lib/chaski.ts
import { createChaskiClient } from 'chaskijs/client';

export const chaskiClient = createChaskiClient({ baseUrl: '/me/notifications' });
```

**From another origin**, the frontend needs three things the same origin gets for free:

1. A full `baseUrl` and a `fetch` that sends the session cookie:

   ```ts
   export const chaskiClient = createChaskiClient({
     baseUrl: 'https://app.example.com/me/notifications',
     fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
   });
   ```

2. The frontend’s origin in `allowedOrigins` on the user routes. Chaski refuses writes and socket
   upgrades from origins it doesn’t know, with a 403 `cross-origin request refused`.
3. CORS on the host, which Chaski doesn’t add. Register Hono’s `cors()` for the user routes’ path
   before mounting them:

   ```ts
   import { cors } from 'hono/cors';

   app.use(
     '/me/notifications/*',
     cors({ origin: ['https://frontend.example.com'], credentials: true }),
   );
   ```

   The session cookie must also reach the host on a cross-site request (`SameSite=None; Secure`),
   which is the host’s own auth setting.

**Done when** `await chaskiClient.feed.unreadCount()` in the signed-in frontend returns
`{ unread: <number> }`. A `ChaskiRequestError` with `status: 401` means the session didn’t reach
`identify`.

## 3. The feed

With React, wrap the app once, near the root, and use the hooks anywhere below:

```tsx
import { ChaskiProvider, useFeed, useUnreadCount } from 'chaskijs/react';
import { chaskiClient } from './lib/chaski';

const Bell = () => {
  const { unread } = useUnreadCount();
  const { items, status, hasMore, loadMore, markRead, markAllRead } = useFeed({ limit: 20 });
  // render the count, then items: { id, type, title, body, href, readAt, createdAt }
};

<ChaskiProvider client={chaskiClient}>
  <App />
</ChaskiProvider>;
```

The hooks open a WebSocket while mounted and add new items as they arrive; marking an item read
updates the unread count on the same page at once, and in the user’s other tabs and devices
through the socket. `useFeed({ enabled: false })` holds the first load
until a panel opens.

Without React, `chaskiClient.feed` has `list()`, `unreadCount()`, `markRead()` and
`subscribe(listener)`, which opens the socket for the first listener and returns the function that
stops listening. A new item reaches the listener whole (`{ type: 'feed_item.created', item }`),
with its `notificationId` and the send’s `data`; the listener hears `undefined` when the socket
comes back after a drop, or when polling notices something, and should list the feed again then.
When the socket keeps failing, the client falls back to checking once a minute.

**With a query cache**, keep Chaski’s data there instead of in the hooks:

```ts
import { CHASKI_QUERY_KEY, chaskiQueries } from 'chaskijs/client';

const queries = chaskiQueries(chaskiClient);
const unread = useQuery(queries.unreadCount());
chaskiClient.feed.subscribe(() => queryClient.invalidateQueries({ queryKey: CHASKI_QUERY_KEY }));
```

**Done when** a send of an `in_app` type to the signed-in user’s id shows up in the open page
without a reload.

## 4. Web push

Web push needs `channels.push.vapid` in the config ([setup.md](setup.md), step 6) and a service
worker that hands pushes to Chaski.

**No service worker yet:** write one and bundle it to a file served at `/sw.js`, the path the
client registers by default:

```ts
// src/sw.ts
import { handlePushEvents } from 'chaskijs/sw';

declare const self: ServiceWorkerGlobalScope;

handlePushEvents(self, { icon: '/icon-192.png' });
```

```sh
npx esbuild src/sw.ts --bundle --outfile=public/sw.js   # public/ being what the frontend serves as is
```

Run that bundling step in the frontend’s build, next to its own.

**A service worker already exists:** call `handlePushEvents(self)` inside it, rather than
registering a second one on the same scope, and pass its path to the client:
`createChaskiClient({ baseUrl, push: { serviceWorkerPath: '/service-worker.js' } })`. Its own
`push` and `notificationclick` listeners would show every push a second time: keep them only for
pushes an old path still sends, and have them skip Chaski’s. A worker written as a plain script
needs the bundling step above once it imports `chaskijs/sw`. A `firebase-messaging-sw.js` lives on a
scope of its own and can stay while the project moves off FCM.

Then a toggle. Call `enable()` from a click: some browsers ask for permission only after a user
gesture.

```tsx
import { usePush } from 'chaskijs/react';

const PushToggle = () => {
  const { state, isPending, error, enable, disable } = usePush();
  if (!state || state.permission === 'unsupported') return null;
  return (
    <button disabled={isPending} onClick={state.subscribed ? disable : enable}>
      {state.subscribed ? 'Turn off push' : 'Turn on push'}
    </button>
  );
};
```

Without React: `chaskiClient.push.isSupported()`, `state()`, `enable()` and `disable()`.
`enable()` throws when permission is denied, the server has no VAPID key or the user routes refuse
the browser (`allowPush`). `state()` reads a subscription made with another VAPID key, such as the
one the project’s earlier push provider left, as not subscribed, and `enable()` replaces it. On iPhone and iPad,
web push reaches only a site the user added to the home screen.

A click on a push takes an open window to the push’s link and focuses it, or opens the link in a
new window; open windows also get a message to refresh their feed. A window the service worker
doesn’t control yet (the page that just turned push on, until it reloads) can’t be navigated, so
the link opens in a new one. `handlePushEvents` shows every push the worker
receives, reading `title`, `body` and `href` from its JSON. A push of another shape still shows,
but its click opens `/`, so while an old path sends pushes of its own the worker has to handle
both.

**Done when** `state.subscribed` is `true` after enabling, and a send of a `push` type to the
signed-in user shows a `push` delivery that isn’t skipped with `no_device_tokens`.

## 5. Preferences

```tsx
import { usePreferences } from 'chaskijs/react';

const NotificationSettings = () => {
  const { preferences, topics, update } = usePreferences();
  if (!preferences) return null;
  // preferences.channels: { email?, in_app?, push? }; a channel never set counts as on.
  // topics: [{ topic, types }] from the templates, to offer a switch per type.
  // update({ channels: { email: false } }) merges; update({ mutedTypes }) overwrites the list.
};
```

Without React: `chaskiClient.preferences.get()`, `update()` and `topics()`.

**Done when** turning a type off makes the next send of that type to this user come back with the
delivery skipped as `muted_by_preferences`.

## A native iOS app

The app registers its APNs device token for the signed-in user with
`POST <user routes>/push/subscriptions` and the body `{ "platform": "ios", "deviceToken": "<hex>" }`,
using the app’s own session, or the host calls
`chaski.push.register({ recipient: { id }, platform: 'ios', deviceToken })` from an endpoint of its
own. The config needs `channels.push.apns`.

## An Electron app on macOS

Electron’s main process gets the APNs device token from
`pushNotifications.registerForAPNSNotifications()`, and the client registers it for the signed-in
user with `client.push.registerDevice({ platform: 'macos', deviceToken })`; a development build adds
`environment: 'sandbox'`. On sign-out, `client.push.unregisterDevice(deviceToken)`. The config needs
`channels.push.apns.macos` with the Mac app’s bundle id, and the app must be signed with the push
entitlement (`com.apple.developer.aps-environment`) and a provisioning profile that grants it, or
macOS gives it no token. macOS shows the alert once the user allows the app’s notifications, which
Electron asks for the first time the app uses `Notification`. `client.push.enable()` is web push,
which Electron doesn’t offer: don’t use it there. A click on a push banner while the app runs
reaches no Electron event; the push only reaches the app through the click that launches it
(`launchInfo` of `ready`).

## Electron’s main process

When the renderer has no network, the client runs in the main process on Node’s `fetch` and
`WebSocket`, with the host’s full URL as `baseUrl`. Node sends no cookies, so the app adds its
credentials to every request and to the socket, plus an `Origin` that `allowedOrigins` lists:

```ts
const headers = { authorization: `Bearer ${token}`, origin: 'app://app' };
const chaskiClient = createChaskiClient({
  baseUrl: 'https://app.example.com/me/notifications',
  fetch: (input, init = {}) => fetch(input, { ...init, headers: { ...init.headers, ...headers } }),
  feed: { socketFactory: (url) => new WebSocket(url, { headers }) },
});
```

`identify` reads that header. A renderer with network authenticates with a `SameSite=None; Secure`
cookie instead: the browser’s WebSocket can’t carry a header.

## A Windows app

Windows apps, Electron ones included, get a WNS channel URI from the Windows App SDK’s
`PushNotificationManager` (`CreateChannelAsync` with the Entra app’s id), through a native module
of the app’s own: Electron has no Windows push API. The client registers the URI with
`client.push.registerDevice({ platform: 'windows', deviceToken: channelUri })`, on every launch,
since channels expire after 30 days. The config needs `channels.push.wns` with the same Entra app.
A click on the toast hands the app the push’s `href` and `tag` as launch arguments
(`AppNotificationActivatedEventArgs.Arguments`).

## A native Android app

The app registers its FCM registration token (`FirebaseMessaging.getInstance().token`) for the
signed-in user with `POST <user routes>/push/subscriptions` and the body
`{ "platform": "android", "deviceToken": "<token>" }`, and again from `onNewToken` when FCM
rotates it, or the host calls
`chaski.push.register({ recipient: { id }, platform: 'android', deviceToken })` from an endpoint of
its own. The config needs `channels.push.fcm`. Android shows the notification on its own while the
app is in the background; the push’s `href` and `tag` arrive in the intent’s extras.

## Content-Security-Policy on the frontend

Same origin, `connect-src 'self'` covers the requests and, in current browsers, the socket. From
another origin, add the host’s `https://` origin and its `wss://` origin to `connect-src`. The
service worker’s script must pass `worker-src`, which falls back to `child-src`, then
`script-src`, then `default-src`.
