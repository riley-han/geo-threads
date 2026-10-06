import type { Trail, TrailFinisher, TrailRevealMode, TrailStopDraft } from '@/data/types';
import type { LatLng } from '@/lib/geo';
import { supabase } from '@/lib/supabase';

import { describeError } from './errors';
import { toEpochMs, toTrail, type TrailRowWithStops } from './mappers';

/**
 * Every trail in your threads, with the stops RLS lets you see and the unlocks
 * on them. Hidden stops are not in `stops` at all; `step_count` on the trail
 * row is what lets progress read "Stop 2 of 5" anyway.
 */
const TRAIL_SELECT = `
  id, conversation_id, created_by, title, reveal_mode, step_count, created_at,
  hint_after_minutes,
  hints:trail_hints ( user_id, step ),
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
  hintAfterMinutes: number | null;
  stops: TrailStopDraft[];
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_trail', {
    p_conversation_id: args.conversationId,
    p_title: args.title,
    p_reveal_mode: args.revealMode,
    p_hint_after_minutes: args.hintAfterMinutes ?? undefined,
    p_stops: args.stops.map((s) => ({
      body: s.body,
      latitude: s.fence.latitude,
      longitude: s.fence.longitude,
      radius_meters: s.fence.radiusMeters,
      label: s.fence.label,
      next_clue: s.nextClue,
      opens_at: s.opensAt?.toISOString() ?? null,
      closes_at: s.closesAt?.toISOString() ?? null,
    })),
  });
  if (error) return { id: null, error: describeError(error) };
  return { id: data as string, error: null };
}

export type CheckInResult = 'unlocked' | 'not_here' | 'too_many' | 'not_open' | 'closed';

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

export type HintResult = 'revealed' | 'too_soon' | 'disabled' | 'not_needed';

/**
 * Reveals a clue-mode stop's pin once you have been stuck long enough. The
 * server checks the delay against its own clock; the client only decides
 * whether to offer the button.
 */
export async function requestTrailHint(
  trailId: string,
  step: number,
): Promise<{ result: HintResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc('use_trail_hint', { p_trail_id: trailId, p_step: step });
  if (error) return { result: null, error: describeError(error) };
  return { result: data as HintResult, error: null };
}

/** Who finished, in order. Finishers who turned receipts off are left out (except you). */
export async function fetchTrailFinishers(
  trailId: string,
): Promise<{ finishers: TrailFinisher[]; error: string | null }> {
  const { data, error } = await supabase.rpc('trail_finishers', { p_trail_id: trailId });
  if (error) return { finishers: [], error: describeError(error) };
  return {
    finishers: (data ?? []).map((r) => ({
      personId: r.user_id,
      finishedAt: toEpochMs(r.finished_at) ?? 0,
      place: Number(r.place),
    })),
    error: null,
  };
}
