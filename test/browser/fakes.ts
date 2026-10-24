import { vi } from 'vitest';

/** A WebSocket the test drives by hand. */
export class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data });
  }

  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

export const socketFactory = () => {
  const sockets: FakeSocket[] = [];
  const factory = (url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  return { sockets, factory };
};

type Route = (body: unknown) => unknown | Response;

/** A fetch that answers `METHOD path` routes and records every call. */
export const fakeFetch = (routes: Record<string, Route>) => {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const route = routes[`${method} ${url.replace(/\?.*$/, '')}`];
    if (!route) return Response.json({ error: 'not_found', message: 'no route' }, { status: 404 });
    const answer = route(body);
    return answer instanceof Response ? answer : Response.json(answer);
  });
  return { calls, fetch: fetcher as unknown as typeof fetch };
};
