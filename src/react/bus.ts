// The socket never hears about reads made from this page, so hooks tell each
// other through this bus. The event carries the change, so peers apply it
// without refetching, and `origin` lets a hook skip its own echo.
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
