import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelsOverview } from '../../src/dashboard/lib/channels';
import { useAdminEvents } from '../../src/dashboard/lib/events';
import { FakeSocket, fakeFetch } from './fakes';

let sockets: FakeSocket[] = [];

// The hook builds its socket with `new WebSocket()`, so the fake takes the global's place.
class GlobalSocket extends FakeSocket {
  static OPEN = 1;

  constructor(url: string) {
    super(url);
    sockets.push(this);
  }
}

const renderDashboard = (realtime: boolean) => {
  const network = fakeFetch({
    'GET https://app.example.com/api/channels': () => ({ dryRun: false, realtime, channels: [] }),
  });
  vi.stubGlobal('fetch', network.fetch);
  vi.stubGlobal('WebSocket', GlobalSocket);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(
    () => {
      useAdminEvents();
      return useChannelsOverview();
    },
    { wrapper },
  );
  return { network, result };
};

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('dashboard events', () => {
  it('opens no socket when the server has no realtime binding', async () => {
    const { network, result } = renderDashboard(false);

    await vi.waitFor(() => expect(result.current.data?.realtime).toBe(false));
    await act(() => vi.advanceTimersByTimeAsync(120_000));

    expect(sockets).toEqual([]);
    expect(network.calls.map((call) => call.url)).toEqual(['https://app.example.com/api/channels']);
  });

  it('opens the socket once the server says realtime is on, and reconnects after a drop', async () => {
    renderDashboard(true);

    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(sockets[0]?.url).toBe('wss://app.example.com/api/events');

    act(() => sockets[0]?.drop());
    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(sockets).toHaveLength(2);
  });
});
