// React wiring for the provider layer: one ProvidersProvider at the app root,
// created once per mount; screens keep their props and pull handles through
// useProviders. useData resolves a WalletData call into render state.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { createProviders, readDataMode } from './index';
import { setNetwork, type NetworkFlag } from '../../config/endpoints';
import type { Providers, WalletData } from './types';

const ProvidersContext = createContext<Providers | null>(null);

export function ProvidersProvider({ children, network = 'mainnet' }: { children: React.ReactNode; network?: NetworkFlag }) {
  // One provider set per active network: switching tears down the previous
  // instances, so every session cache (home bundle, token metadata, xpubs)
  // is cleared with the network instead of leaking across chains.
  const value = useMemo(() => {
    setNetwork(network);
    return createProviders(readDataMode());
  }, [network]);
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
export function useData<T>(load: (data: WalletData) => Promise<T>): T | null {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is an inline arrow recreated every render
  }, [data]);
  return value;
}

/**
 * useData with an error surface and a refresh key: the screens that show
 * offline, stale and retry states (Home, Receive) read the error instead of
 * waiting forever on a skeleton, and bumping refreshKey re-runs the load
 * (polling and pull-to-refresh both drive it).
 */
export function useDataState<T>(
  load: (data: WalletData) => Promise<T>,
  refreshKey: unknown,
): { data: T | null; error: Error | null; loadedAt: number } {
  const { data } = useProviders();
  const [state, setState] = useState<{ data: T | null; error: Error | null; loadedAt: number }>({
    data: null,
    error: null,
    loadedAt: 0,
  });
  useEffect(() => {
    let live = true;
    load(data).then(
      (resolved) => {
        if (live) setState({ data: resolved, error: null, loadedAt: Date.now() });
      },
      (e: unknown) => {
        // A failed refresh retains the last-known-good data: the offline and
        // stale banners render over it instead of blanking the portfolio,
        // assets and activity mid-session. A first load (no data yet) still
        // surfaces the error states.
        if (live) {
          setState((s) => ({ data: s.data, error: e instanceof Error ? e : new Error(String(e)), loadedAt: Date.now() }));
        }
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is an inline arrow recreated every render
  }, [data, refreshKey]);
  return state;
}
