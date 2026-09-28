import type { Person } from '@/data/types';
import { supabase } from '@/lib/supabase';

import { describeError } from './errors';
import { toPerson } from './mappers';

const PROFILE_FIELDS = 'id, name, handle, avatar_url';

/**
 * PostgREST's filter grammar is comma- and paren-delimited, and `ilike` treats
 * `*` as a wildcard. An unescaped `,` or `)` in a search box does not return
 * nothing, it returns a 400 — so strip the characters that would break the
 * query or widen it unintentionally.
 */
const UNSAFE_IN_FILTER = /[,.()%*:"'\\]/g;

/** Below this, a search matches most of the table; make the user type more. */
const MIN_QUERY_LENGTH = 2;

export async function searchProfiles(
  query: string,
  myId: string,
): Promise<{ people: Person[]; error: string | null }> {
  const q = query.trim().replace(UNSAFE_IN_FILTER, '');
  if (q.length < MIN_QUERY_LENGTH) return { people: [], error: null };

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    // `profiles` is readable by any signed-in user — that is what makes finding
    // a stranger possible — so exclude yourself explicitly or you find yourself.
    .neq('id', myId)
    .or(`name.ilike.*${q}*,handle.ilike.*${q}*`)
    .order('name')
    .limit(30);

  if (error) return { people: [], error: describeError(error) };
  return { people: data.map(toPerson), error: null };
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
