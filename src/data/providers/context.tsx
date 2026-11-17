// React wiring for the provider layer: one ProvidersProvider at the app root,
// created once per mount; screens keep their props and pull handles through
// useProviders. useData resolves a WalletData call into render state.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { createProviders, readDataMode } from './index';
import type { Providers, WalletData } from './types';

const ProvidersContext = createContext<Providers | null>(null);

export function ProvidersProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => createProviders(readDataMode()), []);
  return <ProvidersContext.Provider value={value}>{children}</ProvidersContext.Provider>;
}

export function useProviders(): Providers {
  const providers = useContext(ProvidersContext);
  if (!providers) throw new Error('useProviders requires ProvidersProvider');
  return providers;
}

/**
 * Resolve one WalletData call. Fixtures settle in a microtask, so callers
 * render the app chrome on the first frame and identical content right after.
 */
export function useData<T>(load: (data: WalletData) => Promise<T>, deps: readonly unknown[] = []): T | null {
  const { data } = useProviders();
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    load(data).then((resolved) => {
      if (live) setValue(resolved);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the changing inputs via deps
  }, [data, ...deps]);
  return value;
}
