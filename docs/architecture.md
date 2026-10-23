# Architecture

chaski is a notification engine that lives inside another project's Worker. This page records what
is decided and what is still open. None of it is built yet, so names and shapes can still move as
the engine lands. A pull request that changes a decided point updates this page too.

## Decided

### One instance per project

chaski is single-tenant. Each project runs its own instance with its own database, so there are no
organizations, apps or environments inside chaski. A second environment is another deployment of
the host Worker, with its own bindings.

### One package

chaski ships as a single npm package, `chaski`, with the dashboard inside it. The repository is that
package, not a monorepo.

### Mounted on a route of the host Worker

The host mounts chaski on a route, the way Swagger UI or Bull Board mount into an app. The tentative
shape, in a Hono app:

```ts
app.route('/chaski', chaski.routes({ dashboard: { authorize } }));
```

Under that route live:

| Path               | What                                      |
| ------------------ | ----------------------------------------- |
| `/`                | The dashboard                             |
| `/api/*`           | The admin API                             |
| `/api/events`      | A WebSocket that streams dashboard events |
| `/t/o/:deliveryId` | The email open pixel                      |

The open pixel is public: email clients load it without credentials.

### The host declares the bindings

chaski runs on the host's Cloudflare resources, and the host declares every binding in its own
Wrangler config:

- **D1** for the database.
- **Queue** with its dead-letter queue.
- **Durable Objects**, two of them: the in-app feed and the dashboard events.
- **Workflow** for scheduled sends.
- **R2** for attachments.
- **`send_email`** for email.

Cloudflare requires Durable Object and Workflow classes to be exported from the Worker's main
module, so the host re-exports the classes chaski provides.

### Channels

chaski delivers through three channels: email, push (web push and APNs) and the in-app feed.
Channels sit behind a channel registry, which is the extension point for adding more.

### Templates and sending

Templates are written in Liquid. Sending happens in process: the host's Worker code calls chaski
directly, with no HTTP request in between.

### VAPID keys can be imported

Web push subscriptions are tied to the VAPID public key they were created with. A new key pair
orphans every existing subscription, so chaski must accept an existing key pair instead of only
generating its own.

## Open

- **Transport for consumers outside Workers.** Likely HTTP with API keys.
- **Dashboard authentication.** The host's own session, or Cloudflare Access.
- **MCP server.** Whether chaski exposes one, and what it covers.
