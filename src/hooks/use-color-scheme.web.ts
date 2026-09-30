import { useSyncExternalStore } from 'react';

import { useAppearance, type ResolvedScheme } from '@/store/appearance-store';

const noopSubscribe = () => () => {};

/**
 * To support static rendering, the stored choice is only applied on the client;
 * the server snapshot (and so the first hydrating render) uses the default dark scheme.
 */
export function useColorScheme(): ResolvedScheme {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const { scheme } = useAppearance();

  return isClient ? scheme : 'dark';
}
