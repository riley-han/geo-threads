import type { Person } from '@/data/types';
import { supabase } from '@/lib/supabase';

import { describeError } from './errors';
import { toEpochMs, toPerson } from './mappers';

/**
 * Three-valued, unlike the server's two-valued enum. The server records
 * direction in the columns (`requester_id` / `addressee_id`) and the status
 * only says pending or accepted; the UI needs to know whether a pending request
 * is waiting on *you*, so direction is folded into the status here.
 */
export type FriendStatus = 'pending_out' | 'pending_in' | 'accepted';

export type Friendship = {
  /** The row id, needed to accept or delete — the pair alone does not identify it. */
  id: string;
  /** The other person. Never you. */
  person: Person;
  status: FriendStatus;
  updatedAt: number;
};

/** Both hints are mandatory: `friendships` has two foreign keys into `profiles`. */
const FRIENDSHIP_SELECT = `
  id, requester_id, addressee_id, status, updated_at,
  requester:profiles!friendships_requester_id_fkey ( id, name, handle, avatar_url ),
  addressee:profiles!friendships_addressee_id_fkey ( id, name, handle, avatar_url )
`;

type FriendshipRowWithRefs = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  updated_at: string;
  requester: { id: string; name: string; handle: string; avatar_url: string | null } | null;
  addressee: { id: string; name: string; handle: string; avatar_url: string | null } | null;
};

/**
 * One query behind every social hook. RLS restricts it to rows where you are
 * one of the two sides, so there is no filter to write here.
 */
export async function fetchFriendships(
  myId: string,
): Promise<{ friendships: Friendship[]; error: string | null }> {
  const { data, error } = await supabase.from('friendships').select(FRIENDSHIP_SELECT);
  if (error) return { friendships: [], error: describeError(error) };

  const friendships = (data as unknown as FriendshipRowWithRefs[])
    .map((row): Friendship | null => {
      const iAmRequester = row.requester_id === myId;
      const other = iAmRequester ? row.addressee : row.requester;
      if (!other) return null;

      return {
        id: row.id,
        person: toPerson(other),
        status:
          row.status === 'accepted' ? 'accepted' : iAmRequester ? 'pending_out' : 'pending_in',
        updatedAt: toEpochMs(row.updated_at) ?? 0,
      };
    })
    .filter((f): f is Friendship => f !== null);

  return { friendships, error: null };
}

export async function sendFriendRequest(
  otherId: string,
  myId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: myId, addressee_id: otherId, status: 'pending' });

  return { error: error ? describeError(error) : null };
}

/** Only the addressee may accept — the policy enforces it, not this function. */
export async function acceptFriendRequest(
  friendshipId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId);

  return { error: error ? describeError(error) : null };
}

/** Declining, withdrawing and unfriending are all the same row disappearing. */
export async function removeFriendship(friendshipId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  return { error: error ? describeError(error) : null };
}

export async function updateMyProfile(
  myId: string,
  patch: { name: string; handle: string },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ name: patch.name, handle: patch.handle })
    .eq('id', myId);

  return { error: error ? describeError(error, 'profile') : null };
}
