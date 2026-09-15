import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import type { Contact } from '@/data/contacts';
import { contactById } from '@/data/contacts';
import * as repo from '@/db/social-repository';
import type { FriendStatus, Friendship, MyProfile } from '@/db/social-repository';

// ---------------------------------------------------------------------------
// DEMO SCAFFOLDING — delete this block once friend requests are served.
// There is no second device to accept an outgoing request, so one auto-accepts
// after a delay. Applied two ways so it survives a relaunch: a live timer, and
// a reconcile pass on load that promotes anything already past the deadline.
const DEMO_AUTO_ACCEPT_MS = 6_000;
const demoShouldAutoAccept = (f: Friendship, now: number) =>
  f.status === 'pending_out' && now - f.updatedAt >= DEMO_AUTO_ACCEPT_MS;
// ---------------------------------------------------------------------------

type SocialApi = {
  profile: MyProfile;
  friendships: Friendship[];
  updateProfile: (next: MyProfile) => void;
  sendRequest: (contactId: string) => void;
  acceptRequest: (contactId: string) => void;
  declineRequest: (contactId: string) => void;
  removeFriend: (contactId: string) => void;
};

const SocialContext = createContext<SocialApi | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [profile, setProfile] = useState<MyProfile>({ name: 'You', handle: '@you' });
  const [friendships, setFriendships] = useState<Friendship[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, f] = await Promise.all([repo.loadProfile(db), repo.loadFriendships(db)]);
      if (cancelled) return;
      setProfile(p);

      const now = Date.now();
      const overdue = f.filter((x) => demoShouldAutoAccept(x, now));
      for (const x of overdue) {
        void repo.upsertFriendship(db, x.contactId, 'accepted', now);
      }
      setFriendships(
        f.map((x) =>
          demoShouldAutoAccept(x, now)
            ? { ...x, status: 'accepted' as FriendStatus, updatedAt: now }
            : x,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const write = (contactId: string, status: FriendStatus) => {
    const updatedAt = Date.now();
    setFriendships((prev) => {
      const rest = prev.filter((f) => f.contactId !== contactId);
      return [...rest, { contactId, status, updatedAt }];
    });
    void repo.upsertFriendship(db, contactId, status, updatedAt);
  };

  const remove = (contactId: string) => {
    setFriendships((prev) => prev.filter((f) => f.contactId !== contactId));
    void repo.deleteFriendship(db, contactId);
  };

  const sendRequest = (contactId: string) => {
    write(contactId, 'pending_out');
    // DEMO SCAFFOLDING — see block above.
    setTimeout(() => write(contactId, 'accepted'), DEMO_AUTO_ACCEPT_MS);
  };

  const updateProfile = (next: MyProfile) => {
    setProfile(next);
    void repo.saveProfile(db, next);
  };

  return (
    <SocialContext.Provider
      value={{
        profile,
        friendships,
        updateProfile,
        sendRequest,
        acceptRequest: (id) => write(id, 'accepted'),
        declineRequest: remove,
        removeFriend: remove,
      }}>
      {children}
    </SocialContext.Provider>
  );
}

function useSocial(): SocialApi {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('SocialProvider is missing');
  return ctx;
}

export function useMyProfile(): MyProfile {
  return useSocial().profile;
}

export function useSocialActions() {
  const { updateProfile, sendRequest, acceptRequest, declineRequest, removeFriend } = useSocial();
  return { updateProfile, sendRequest, acceptRequest, declineRequest, removeFriend };
}

export function useFriendStatus(contactId: string): FriendStatus | undefined {
  return useSocial().friendships.find((f) => f.contactId === contactId)?.status;
}

/** Status for every contact at once — avoids a scan per row in a list. */
export function useFriendStatusMap(): Map<string, FriendStatus> {
  return new Map(useSocial().friendships.map((f) => [f.contactId, f.status]));
}

export function useFriends(): Contact[] {
  return useSocial()
    .friendships.filter((f) => f.status === 'accepted')
    .map((f) => contactById(f.contactId))
    .filter((c) => c !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function useFriendIds(): string[] {
  return useSocial()
    .friendships.filter((f) => f.status === 'accepted')
    .map((f) => f.contactId);
}

export function usePendingRequests(): Contact[] {
  return useSocial()
    .friendships.filter((f) => f.status === 'pending_in')
    .map((f) => contactById(f.contactId))
    .filter((c) => c !== undefined);
}
