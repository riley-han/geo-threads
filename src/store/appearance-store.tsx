import Storage from 'expo-sqlite/kv-store';
import { createContext, use, useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme as useSystemColorScheme } from 'react-native';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'appearance';

/** Dark is the house look; people opt into light or into following the OS. */
const DEFAULT_PREFERENCE: AppearancePreference = 'dark';

function readStored(): AppearancePreference {
  try {
    const value = Storage.getItemSync(STORAGE_KEY);
    return value === 'system' || value === 'light' || value === 'dark' ? value : DEFAULT_PREFERENCE;
  } catch {
    // Storage is unavailable in some web contexts; the default still renders.
    return DEFAULT_PREFERENCE;
  }
}

type AppearanceContextValue = {
  preference: AppearancePreference;
  scheme: ResolvedScheme;
  setPreference: (next: AppearancePreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  // Read synchronously so the first frame is already in the right theme.
  const [preference, setPreferenceState] = useState(readStored);
  const system = useSystemColorScheme();

  // Also override the native appearance, so native chrome we do not draw
  // ourselves (tab bar, maps, glass, keyboards, alerts) follows the choice.
  useLayoutEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const setPreference = useCallback((next: AppearancePreference) => {
    setPreferenceState(next);
    try {
      Storage.setItemSync(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
  }, []);

  // Once the native override lands, `system` reports the override rather than
  // the OS, so it is only consulted when following the OS.
  const scheme: ResolvedScheme =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;

  return (
    <AppearanceContext value={{ preference, scheme, setPreference }}>{children}</AppearanceContext>
  );
}

export function useAppearance(): AppearanceContextValue {
  const value = use(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used inside AppearanceProvider');
  return value;
}
