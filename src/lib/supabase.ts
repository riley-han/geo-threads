// Provides the `localStorage` that supabase-js uses to persist the auth session
// on device. This is the SDK 57 approach — the shim no-ops on web, where the
// real localStorage already exists, so one import covers every platform.
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import type { Database } from '@/lib/database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// EXPO_PUBLIC_ vars are inlined at build time, so a missing one is a build-time
// mistake, not a runtime condition. Failing loudly here beats a stream of
// "Invalid API key" responses from every query in the app.
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env.local and fill in ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then ' +
      'restart the dev server with `npx expo start --clear` — env vars are ' +
      'inlined at build time, so a running server will not pick them up.',
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no URL to read a session from on iOS or Android. Leaving this on
    // makes supabase-js look for one and log a spurious failure on every start.
    detectSessionInUrl: false,
  },
});

// supabase-js refreshes the access token on a timer. That timer is useless while
// the app is backgrounded and, worse, can fire a burst of refreshes on resume,
// so it is stopped and restarted with the app's foreground state.
let appStateSubscription: { remove: () => void } | null = null;

function onAppStateChange(state: AppStateStatus) {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
}

/**
 * Ties the token-refresh loop to the app's foreground state. Called once from
 * the auth provider; returns a teardown so Fast Refresh does not stack
 * listeners across reloads.
 */
export function startAutoRefreshWithAppState(): () => void {
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener('change', onAppStateChange);
  // The app is already foregrounded when this runs, and 'change' only fires on
  // a transition, so prime the loop rather than waiting for the first blur.
  if (AppState.currentState === 'active') void supabase.auth.startAutoRefresh();

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    void supabase.auth.stopAutoRefresh();
  };
}
