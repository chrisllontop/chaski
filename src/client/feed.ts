import type { FeedPage, FeedSocketEvent } from '../contract/contract';
import type { Request } from './http';

export type FeedConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'polling'
  | 'closed';

export type FeedOptions = {
  /** Builds the socket; tests and custom transports pass their own. Defaults to `new WebSocket(url)`. */
  socketFactory?: (url: string) => WebSocket;
  reconnect?: { minDelayMs?: number; maxDelayMs?: number; maxAttempts?: number };
  /** How often to check for new items once reconnecting gave up. */
  pollIntervalMs?: number;
  /** How often to ping the socket; the runtime answers without waking the server. */
  heartbeatMs?: number;
};

export type FeedListQuery = {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
};

/**
 * Called when the feed changes: with the socket event (an item created, or items read in another
 * tab or device), or without one when polling noticed or the socket came back after a drop, when
 * items may have arrived unannounced.
 */
export type FeedListener = (event?: FeedSocketEvent) => void;

export type FeedClient = {
  list(query?: FeedListQuery): Promise<FeedPage>;
  unreadCount(): Promise<{ unread: number }>;
  /** Marks the given items, everything up to an instant, or with no argument the whole feed. */
  markRead(input?: { ids?: string[]; before?: string }): Promise<{ marked: number }>;
  /** The first listener opens the socket and the last one to leave closes it. */
  subscribe(listener: FeedListener): () => void;
  onStatusChange(listener: (status: FeedConnectionStatus) => void): () => void;
  status(): FeedConnectionStatus;
};

const KNOWN_EVENTS = new Set<string>(['feed_item.created', 'feed_item.read']);

// Events of a type this client doesn't know are dropped, so the server can
// add new ones without breaking older bundles.
const parseEvent = (raw: unknown): FeedSocketEvent | null => {
  try {
    const value = JSON.parse(String(raw)) as { type?: unknown };
    return typeof value?.type === 'string' && KNOWN_EVENTS.has(value.type)
      ? (value as FeedSocketEvent)
      : null;
  } catch {
    return null;
  }
};

/** Names, on the socket, the device whose pushes the open feed takes over. */
export type FeedDeviceLink = { setDevice(id: string | null): void };

export const createFeedClient = (
  request: Request,
  baseUrl: string,
  options: FeedOptions = {},
): FeedClient & FeedDeviceLink => {
  const minDelayMs = options.reconnect?.minDelayMs ?? 1_000;
  const maxDelayMs = options.reconnect?.maxDelayMs ?? 30_000;
  const maxAttempts = options.reconnect?.maxAttempts ?? 5;
  const pollIntervalMs = options.pollIntervalMs ?? 60_000;
  const heartbeatMs = options.heartbeatMs ?? 30_000;

  const listeners = new Set<FeedListener>();
  const statusListeners = new Set<(status: FeedConnectionStatus) => void>();

  let status: FeedConnectionStatus = 'idle';
  let wanted = false;
  let socket: WebSocket | null = null;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastUnread: number | null = null;
  // The subscriber's own first load covers the first connection; any later one may have missed
  // items while no socket was open.
  let connectedBefore = false;
  let device: string | null = null;

  const setStatus = (next: FeedConnectionStatus) => {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(next);
  };

  const emit = (event?: FeedSocketEvent) => {
    for (const listener of listeners) listener(event);
  };

  const unreadCount = async () => {
    const result = await request<{ unread: number }>('GET', '/feed/unread-count');
    lastUnread = result.unread;
    return result;
  };

  const socketUrl = () => {
    const path = `${baseUrl}/feed/socket${device ? `?device=${encodeURIComponent(device)}` : ''}`;
    const base = typeof location === 'undefined' ? undefined : location.href;
    // Outside a browser a relative baseUrl has no page to resolve against, so the factory gets
    // the path.
    if (base === undefined && !URL.canParse(baseUrl)) return path;
    const url = new URL(path, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pongTimer) clearTimeout(pongTimer);
    heartbeatTimer = null;
    pongTimer = null;
  };

  const dropSocket = () => {
    stopHeartbeat();
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // Already closing.
    }
    socket = null;
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const startPolling = () => {
    if (pollTimer) return;
    setStatus('polling');
    pollTimer = setInterval(async () => {
      // Every round also tries the socket again; once it opens, polling stops.
      openSocket();
      const before = lastUnread;
      try {
        const { unread } = await unreadCount();
        if (before !== null && unread > before) emit();
      } catch {
        // The next round tries again.
      }
    }, pollIntervalMs);
  };

  const scheduleReconnect = () => {
    if (!wanted || reconnectTimer) return;
    if (attempts >= maxAttempts) {
      startPolling();
      return;
    }
    setStatus('reconnecting');
    // Full jitter keeps a fleet of tabs from reconnecting in lockstep after a deploy.
    const cap = Math.min(maxDelayMs, minDelayMs * 2 ** attempts);
    attempts += 1;
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = null;
        openSocket();
      },
      cap / 2 + Math.random() * (cap / 2),
    );
  };

  const startHeartbeat = (ws: WebSocket) => {
    heartbeatTimer = setInterval(() => {
      if (ws.readyState !== 1) return;
      ws.send('ping');
      // No pong within the grace period means the connection is dead even
      // though close never fired, as happens when a laptop sleeps.
      pongTimer = setTimeout(
        () => {
          dropSocket();
          scheduleReconnect();
        },
        Math.min(10_000, heartbeatMs),
      );
    }, heartbeatMs);
  };

  const openSocket = () => {
    if (!wanted || socket) return;
    const factory =
      options.socketFactory ??
      (typeof WebSocket === 'undefined' ? null : (url: string) => new WebSocket(url));
    if (!factory) {
      startPolling();
      return;
    }
    if (status !== 'polling') setStatus(attempts > 0 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = factory(socketUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      const missedAny = connectedBefore || attempts > 0 || status === 'polling';
      connectedBefore = true;
      attempts = 0;
      stopPolling();
      setStatus('open');
      startHeartbeat(ws);
      if (missedAny) emit();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (event.data === 'pong') {
        if (pongTimer) clearTimeout(pongTimer);
        pongTimer = null;
        return;
      }
      const parsed = parseEvent(event.data);
      if (parsed) emit(parsed);
    };
    ws.onclose = () => {
      const wasOpen = status === 'open';
      dropSocket();
      if (!wanted) return;
      if (wasOpen) attempts = 0;
      scheduleReconnect();
    };
    // close always follows error, and close owns the retry.
    ws.onerror = () => {};
  };

  // A tab coming back to the foreground reconnects at once instead of waiting
  // out a backoff it built up in the background.
  const onVisible = () => {
    if (!wanted || document.visibilityState !== 'visible') return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    attempts = 0;
    openSocket();
  };

  const connect = () => {
    wanted = true;
    attempts = 0;
    connectedBefore = false;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    openSocket();
  };

  const disconnect = () => {
    wanted = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopPolling();
    dropSocket();
    setStatus('closed');
  };

  return {
    list: (query = {}) => {
      const params = new URLSearchParams();
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.limit) params.set('limit', String(query.limit));
      if (query.unreadOnly) params.set('unreadOnly', 'true');
      return request<FeedPage>('GET', params.size > 0 ? `/feed?${params}` : '/feed');
    },
    unreadCount,
    markRead: (input = {}) => request<{ marked: number }>('POST', '/feed/read', input),
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) connect();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) disconnect();
      };
    },
    onStatusChange: (listener) => {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    status: () => status,
    setDevice: (id) => {
      if (id === device) return;
      device = id;
      // The open socket names the old device, or none: the server only reads it on connect.
      if (!socket) return;
      dropSocket();
      openSocket();
    },
  };
};
