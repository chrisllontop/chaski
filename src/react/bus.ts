// The socket's read signal arrives after the request that made the read, so
// hooks on the page that made it tell each other at once through this bus.
// The event carries the change, so peers apply it without refetching, and
// `origin` lets a hook skip its own echo.
export type ReadChange = { ids: Set<string> | null; origin: string };

export type ReadBus = {
  emit: (change: ReadChange) => void;
  subscribe: (listener: (change: ReadChange) => void) => () => void;
};

export const createReadBus = (): ReadBus => {
  const listeners = new Set<(change: ReadChange) => void>();
  return {
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
