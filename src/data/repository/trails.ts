import type { Trail, TrailRevealMode, TrailStopDraft } from '@/data/types';
import type { LatLng } from '@/lib/geo';
import { supabase } from '@/lib/supabase';

import { describeError } from './errors';
import { toTrail, type TrailRowWithStops } from './mappers';

/**
 * Every trail in your threads, with the stops RLS lets you see and the unlocks
 * on them. Hidden stops are not in `stops` at all; `step_count` on the trail
 * row is what lets progress read "Stop 2 of 5" anyway.
 */
const TRAIL_SELECT = `
  id, conversation_id, created_by, title, reveal_mode, step_count, created_at,
  stops:messages!messages_trail_id_fkey (
    id, trail_step, next_clue,
    unlocks:message_unlocks ( user_id, unlocked_at )
  )
`;

export async function fetchTrails(): Promise<{ trails: Trail[]; error: string | null }> {
  const { data, error } = await supabase
    .from('trails')
    .select(TRAIL_SELECT)
    .order('created_at', { ascending: false });

  if (error) return { trails: [], error: describeError(error) };
  return { trails: (data as unknown as TrailRowWithStops[]).map(toTrail), error: null };
}

/** Sends the trail and every stop in one transaction. */
export async function createTrail(args: {
  conversationId: string;
  title: string;
  revealMode: TrailRevealMode;
  stops: TrailStopDraft[];
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_trail', {
    p_conversation_id: args.conversationId,
    p_title: args.title,
    p_reveal_mode: args.revealMode,
    p_stops: args.stops.map((s) => ({
      body: s.body,
      latitude: s.fence.latitude,
      longitude: s.fence.longitude,
      radius_meters: s.fence.radiusMeters,
      label: s.fence.label,
      next_clue: s.nextClue,
    })),
  });
  if (error) return { id: null, error: describeError(error) };
  return { id: data as string, error: null };
}

export type CheckInResult = 'unlocked' | 'not_here' | 'too_many';

/**
 * Unlocks a stop by being there. For clue-mode stops this is the only way in:
 * the device never has their coordinates, so the server does the comparison.
 */
export async function checkInTrailStep(
  trailId: string,
  step: number,
  position: LatLng,
): Promise<{ result: CheckInResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc('check_in_trail_step', {
    p_trail_id: trailId,
    p_step: step,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
  });
  if (error) return { result: null, error: describeError(error) };
  return { result: data as CheckInResult, error: null };
}
