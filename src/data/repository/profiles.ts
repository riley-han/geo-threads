import type { Person } from '@/data/types';
import { supabase } from '@/lib/supabase';

import { describeError } from './errors';
import { toPerson } from './mappers';

const PROFILE_FIELDS = 'id, name, handle, avatar_url';

/** Below this, a search matches most of the table; the server returns nothing. */
const MIN_QUERY_LENGTH = 2;

/**
 * Finds people by part of their name or handle. `profiles` is only readable
 * for people you already have a reason to see, so strangers come through
 * `search_profiles`: one page of public cards, never yourself, with the
 * search text matched literally.
 */
export async function searchProfiles(
  query: string,
): Promise<{ people: Person[]; error: string | null }> {
  const q = query.trim().replace(/^@/, '');
  if (q.length < MIN_QUERY_LENGTH) return { people: [], error: null };

  const { data, error } = await supabase.rpc('search_profiles', { p_query: q });

  if (error) return { people: [], error: describeError(error) };
  return { people: (data ?? []).map(toPerson), error: null };
}

/** Fills in a sender realtime handed us as a bare id. */
export async function fetchProfile(id: string): Promise<Person | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toPerson(data);
}
