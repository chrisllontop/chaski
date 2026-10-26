import { createContext, createElement, type ReactNode, useContext, useMemo } from 'react';
import type { ChaskiClient } from '../client/index';
import { createReadBus, type ReadBus } from './bus';

type ChaskiContextValue = { client: ChaskiClient; bus: ReadBus };

const ChaskiContext = createContext<ChaskiContextValue | null>(null);

/** Gives the hooks below it a client from createChaskiClient(). */
export const ChaskiProvider = ({
  client,
  children,
}: {
  client: ChaskiClient;
  children?: ReactNode;
}): ReactNode => {
  const value = useMemo(() => ({ client, bus: createReadBus() }), [client]);
  return createElement(ChaskiContext.Provider, { value }, children);
};

export const useChaskiContext = (): ChaskiContextValue => {
  const value = useContext(ChaskiContext);
  if (!value) throw new Error('Chaski hooks need a <ChaskiProvider> above them');
  return value;
};

export const useChaskiClient = (): ChaskiClient => useChaskiContext().client;
