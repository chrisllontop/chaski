import { DurableObject } from 'cloudflare:workers';
import type { FeedSocketEvent } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { resolveConfig } from '../config';

// One instance per recipient, named by the recipient id.
export const feedStub = (recipientId: string) => {
  const namespace = resolveConfig().bindings.feed;
  if (!namespace) throw new ChaskiError('config', 'Chaski config: bindings.feed is missing');
  return namespace.get(namespace.idFromName(recipientId));
};

/** Holds a recipient's open feed sockets and signals new items to them. */
export class ChaskiFeed extends DurableObject<unknown> {
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

  publish(event: FeedSocketEvent): void {
    const message = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // The socket is mid-close; the runtime drops it.
      }
    }
  }

  // The socket only carries server-to-client signals; 'ping' never gets here
  // because the auto-response answers it.
  override webSocketMessage(ws: WebSocket): void {
    ws.close(1003, 'unsupported message');
  }

  // Hosts on compatibility dates before 2026-04-07 must reciprocate the close
  // frame themselves; on later dates the runtime already did and this is a no-op.
  override webSocketClose(ws: WebSocket): void {
    ws.close();
  }
}
