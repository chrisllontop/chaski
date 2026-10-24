import { DurableObject } from 'cloudflare:workers';
import type { AdminEventTopic, AdminSocketEvent } from '../../contract/admin-events';
import { resolveConfig } from '../config';

// A burst of deliveries must not turn into a storm of dashboard refetches,
// each running aggregate SQL on D1: invalidations inside this window merge.
const FLUSH_WINDOW_MS = 2_000;

// One instance serves every dashboard session; null when the host left
// realtime events out.
export const eventsStub = () => {
  const namespace = resolveConfig().bindings.events;
  return namespace ? namespace.get(namespace.idFromName('chaski')) : null;
};

/** Sends invalidations to every open dashboard. */
export class ChaskiEvents extends DurableObject<unknown> {
  private pending = new Set<AdminEventTopic>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Answered by the runtime, so client keepalives never wake a hibernated object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json(
        { error: 'upgrade_required', message: 'expected a WebSocket upgrade' },
        { status: 426 },
      );
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // The first invalidation after a quiet spell goes out at once; the ones that
  // follow within the window go out together when it closes. Pending topics
  // live in memory only, which is fine for a signal that is best effort.
  publish(topics: AdminEventTopic[]): void {
    if (this.ctx.getWebSockets().length === 0) return;
    for (const topic of topics) this.pending.add(topic);
    if (this.flushTimer) return;
    this.flush();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pending.size === 0) return;
      this.flush();
      this.scheduleFlush();
    }, FLUSH_WINDOW_MS);
  }

  private flush(): void {
    const event: AdminSocketEvent = {
      type: 'invalidate',
      topics: [...this.pending],
      at: new Date().toISOString(),
    };
    this.pending.clear();
    const message = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // The socket is mid-close; the runtime drops it.
      }
    }
  }

  override webSocketMessage(ws: WebSocket): void {
    ws.close(1003, 'unsupported message');
  }

  // See ChaskiFeed: hosts on compatibility dates before 2026-04-07 must
  // reciprocate the close frame themselves.
  override webSocketClose(ws: WebSocket): void {
    ws.close();
  }
}
