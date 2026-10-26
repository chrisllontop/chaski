import { useEffect, useState } from 'react';

/**
 * The value once it has held still for `delayMs`. Callers pass fresh objects on
 * every render, so changes are told apart by their JSON, not their identity.
 */
export const useDebounced = <T>(value: T, delayMs = 400): T => {
  const [debounced, setDebounced] = useState(value);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDebounced((current) =>
          JSON.stringify(current) === serialized ? current : (JSON.parse(serialized) as T),
        ),
      delayMs,
    );
    return () => clearTimeout(timer);
  }, [serialized, delayMs]);
  return debounced;
};
