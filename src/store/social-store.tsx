import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import * as repo from '@/data/repository';
import type { Friendship, FriendStatus } from '@/data/repository';
import type { Person } from '@/data/types';
import { useAuth } from '@/store/auth-store';
import type { LoadState } from '@/store/messages-store';

export type { FriendStatus };

type SocialApi = {
  friendships: Friendship[];
  state: LoadState;
  error: string | null;
  refresh: () => Promise<void>;
  sendRequest: (personId: string) => Promise<{ error: string | null }>;
  acceptRequest: (personId: string) => Promise<{ error: string | null }>;
  declineRequest: (personId: string) => Promise<{ error: string | null }>;
  removeFriend: (personId: string) => Promise<{ error: string | null }>;
};

const SocialContext = createContext<SocialApi | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const myId = user?.id ?? null;

  const [friendships, setFriendships] = useState<Friendship[]>([]);
  // 'loading' from the start: the provider always fetches on mount, so saying
  // so up front avoids a synchronous setState inside the effect.
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  /**
   * Applies a fetch result. Split from the fetch so both the mount effect and a
   * manual retry share one reducer, and so the setState calls sit after an
   * awaited boundary rather than synchronously inside an effect body.
   */
  const apply = useCallback((result: Awaited<ReturnType<typeof repo.fetchFriendships>>) => {
    if (result.error) {
      setError(result.error);
      setState('error');
      return;
    }
    setFriendships(result.friendships);
    setError(null);
    setState('ready');
  }, []);

  const load = useCallback(async () => {
    if (!myId) return;
    apply(await repo.fetchFriendships(myId));
  }, [myId, apply]);

  /** Manual retry: show the spinner, then reload. Never called from an effect body. */
  const refresh = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? prev : 'loading'));
    await load();
  }, [load]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!myId) return;
      const result = await repo.fetchFriendships(myId);
      if (active) apply(result);
    })();
    return () => {
      active = false;
    };
  }, [myId, apply]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') void load();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [load]);

  /** Accept, decline and unfriend all act on a row we already hold. */
  const rowFor = useCallback(
    (personId: string) => friendships.find((f) => f.person.id === personId),
    [friendships],
  );

  const sendRequest = useCallback(
    async (personId: string) => {
      if (!myId) return { error: 'Not signed in.' };
      const { error: sendError } = await repo.sendFriendRequest(personId, myId);
      await load();
      return { error: sendError };
    },
    [myId, load],
  );

  const acceptRequest = useCallback(
    async (personId: string) => {
      const row = rowFor(personId);
      if (!row) return { error: 'That request is no longer there.' };

      setFriendships((prev) =>
        prev.map((f) => (f.id === row.id ? { ...f, status: 'accepted' as const } : f)),
      );
      const { error: acceptError } = await repo.acceptFriendRequest(row.id);
      await load();
      return { error: acceptError };
    },
    [rowFor, load],
  );

  const remove = useCallback(
    async (personId: string) => {
      const row = rowFor(personId);
      if (!row) return { error: null };

      setFriendships((prev) => prev.filter((f) => f.id !== row.id));
      const { error: removeError } = await repo.removeFriendship(row.id);
      if (removeError) await load();
      return { error: removeError };
    },
    [rowFor, load],
  );

  const api = useMemo<SocialApi>(
    () => ({
      friendships,
      state,
      error,
      refresh,
      sendRequest,
      acceptRequest,
      // Declining an incoming request and unfriending are the same row going
      // away; they read differently in the UI and identically here.
      declineRequest: remove,
      removeFriend: remove,
    }),
    [friendships, state, error, refresh, sendRequest, acceptRequest, remove],
  );

  return <SocialContext.Provider value={api}>{children}</SocialContext.Provider>;
}

function useSocial(): SocialApi {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('SocialProvider is missing');
  return ctx;
}

export function useSocialState() {
  const { state, error, refresh } = useSocial();
  return { state, error, refresh };
}

export function useSocialActions() {
  const { sendRequest, acceptRequest, declineRequest, removeFriend } = useSocial();
  return useMemo(
    () => ({ sendRequest, acceptRequest, declineRequest, removeFriend }),
    [sendRequest, acceptRequest, declineRequest, removeFriend],
  );
}

export function useFriendStatus(personId: string): FriendStatus | undefined {
  return useSocial().friendships.find((f) => f.person.id === personId)?.status;
}

/** One map rather than a scan per row in a list. */
export function useFriendStatusMap(): Map<string, FriendStatus> {
  const { friendships } = useSocial();
  return useMemo(
    () => new Map(friendships.map((f) => [f.person.id, f.status])),
    [friendships],
  );
}

export function useFriends(): Person[] {
  const { friendships } = useSocial();
  return useMemo(
    () =>
      friendships
        .filter((f) => f.status === 'accepted')
        .map((f) => f.person)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [friendships],
  );
}

export function useFriendIds(): string[] {
  const friends = useFriends();
  return useMemo(() => friends.map((f) => f.id), [friends]);
}

export function usePendingRequests(): Person[] {
  const { friendships } = useSocial();
  return useMemo(
    () => friendships.filter((f) => f.status === 'pending_in').map((f) => f.person),
    [friendships],
  );
}
