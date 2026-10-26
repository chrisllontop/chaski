import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { eventsUrl } from './api';

type AdminSocketEvent = { type: 'invalidate'; topics: string[]; at: string };

// Each topic the server signals maps to the queries that read that data.
const QUERY_KEYS: Record<string, string[][]> = {
  deliveries: [['deliveries'], ['delivery']],
  metrics: [['metrics']],
  templates: [['templates'], ['template']],
};

const invalidate = (client: QueryClient, topics: string[]) => {
  for (const topic of topics) {
    for (const queryKey of QUERY_KEYS[topic] ?? []) void client.invalidateQueries({ queryKey });
  }
};

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

// One socket per dashboard, so its state is module-wide; the header reads it.
let liveStatus: LiveStatus = 'connecting';
const listeners = new Set<() => void>();

const setLiveStatus = (next: LiveStatus) => {
  if (next === liveStatus) return;
  liveStatus = next;
  for (const listener of listeners) listener();
};

export const useLiveStatus = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => liveStatus,
  );

/**
 * Keeps the dashboard's data fresh from /api/events. The socket only says what
 * changed; the queries refetch it. It reconnects with backoff and, without a
 * realtime binding on the server, leaves the queries to their own refetching.
 */
export const useAdminEvents = () => {
  const client = useQueryClient();

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => {
        attempts = 0;
        setLiveStatus('live');
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as AdminSocketEvent;
          if (event.type === 'invalidate') invalidate(client, event.topics);
        } catch {
          // 'pong' and anything else that isn't an event.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setLiveStatus('reconnecting');
        const delay = Math.min(30_000, 1_000 * 2 ** attempts) * (0.5 + Math.random() / 2);
        attempts += 1;
        retry = setTimeout(connect, delay);
      };
    };

    connect();
    // Keepalive the runtime answers without waking the events object.
    const ping = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
    }, 30_000);

    return () => {
      stopped = true;
      clearInterval(ping);
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [client]);
};
