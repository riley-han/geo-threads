import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ProfileRow } from '@/lib/supabase-types';
import { startAutoRefreshWithAppState, supabase } from '@/lib/supabase';

export type AuthResult = { error: string | null };

type AuthApi = {
  session: Session | null;
  user: User | null;
  /** The signed-in user's public profile. Null until the first load resolves. */
  profile: ProfileRow | null;
  /** True until the persisted session has been read — gate routing on this. */
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (args: { email: string; password: string; name: string; handle?: string }) => Promise<
    AuthResult & { needsEmailConfirmation: boolean }
  >;
  signOut: () => Promise<AuthResult>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updateProfile: (patch: Pick<ProfileRow, 'name'> & { handle?: string }) => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthApi | null>(null);

/** Supabase errors are user-facing here, so keep the message and drop the rest. */
const messageOf = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : 'Something went wrong. Please try again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Tagged with the user it was loaded for, so signing out or switching account
  // makes the stale profile fall away by derivation rather than by an effect
  // clearing it — which would cost an extra render and briefly expose the
  // previous user's name.
  const [loaded, setLoaded] = useState<{ userId: string; row: ProfileRow | null } | null>(null);
  const [initializing, setInitializing] = useState(true);

  const userId = session?.user.id ?? null;
  const profile = loaded && loaded.userId === userId ? loaded.row : null;

  useEffect(() => {
    let active = true;

    // Read the session persisted by expo-sqlite's localStorage before deciding
    // where to route, so a returning user never sees the login screen flash.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
    });

    // Deliberately synchronous. supabase-js holds an internal lock while this
    // callback runs, so awaiting another supabase call inside it deadlocks the
    // client — the profile fetch lives in its own effect below instead.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setInitializing(false);
    });

    const stopAutoRefresh = startAutoRefreshWithAppState();

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      stopAutoRefresh();
    };
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    // A missing profile is not an error worth surfacing: the signup trigger
    // creates it, and on a brand-new account the insert can land a moment after
    // the session does.
    if (error) console.warn('[auth] failed to load profile', error.message);
    return data ?? null;
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void loadProfile(userId).then((row) => {
      if (active) setLoaded({ userId, row });
    });
    return () => {
      active = false;
    };
  }, [userId, loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setLoaded({ userId, row: await loadProfile(userId) });
  }, [userId, loadProfile]);

  const api = useMemo<AuthApi>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      initializing,

      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        return { error: error ? messageOf(error) : null };
      },

      signUp: async ({ email, password, name, handle }) => {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          // Read by the handle_new_user trigger to seed the profile row. The
          // trigger owns handle uniqueness, so a taken handle gets suffixed
          // rather than failing the signup.
          options: { data: { name: name.trim(), handle: handle?.trim().toLowerCase() } },
        });
        if (error) return { error: messageOf(error), needsEmailConfirmation: false };

        // With email confirmation on, signUp returns a user but no session.
        return { error: null, needsEmailConfirmation: data.session == null };
      },

      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        return { error: error ? messageOf(error) : null };
      },

      sendPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
        return { error: error ? messageOf(error) : null };
      },

      updateProfile: async (patch) => {
        if (!userId) return { error: 'Not signed in.' };
        const { data, error } = await supabase
          .from('profiles')
          .update({ name: patch.name, ...(patch.handle ? { handle: patch.handle } : {}) })
          .eq('id', userId)
          .select()
          .single();
        if (error) return { error: messageOf(error) };
        setLoaded({ userId, row: data });
        return { error: null };
      },

      refreshProfile,
    }),
    [session, profile, initializing, userId, refreshProfile],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider is missing');
  return ctx;
}

/** True once a session exists. Use with `initializing` before routing on it. */
export function useIsSignedIn(): boolean {
  return useAuth().session != null;
}
