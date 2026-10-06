import type { Trail } from '@/data/types';

/**
 * Where a finder stands on a trail.
 *
 * `next` is the stop to head for. `visible` says whether its row (and so its
 * pin) has been revealed: true in pin mode once the previous stop is found,
 * false in clue mode until you check in. `clue` is the previous stop's
 * next_clue, which is all a clue-mode finder has to go on.
 */
export type FinderProgress = {
  kind: 'finder';
  found: number;
  total: number;
  finished: boolean;
  finishedAt: number | null;
  next: { step: number; visible: boolean; clue: string | null } | null;
};

/**
 * The creator's view: how far each finder has got. Only finders who share
 * receipts appear, since RLS hides the others' unlocks from the creator.
 */
export type CreatorProgress = {
  kind: 'creator';
  total: number;
  people: { personId: string; found: number; finished: boolean }[];
};

export type TrailProgress = FinderProgress | CreatorProgress;

export function trailProgress(trail: Trail, myId: string): TrailProgress {
  if (trail.creatorId === myId) {
    const found = new Map<string, number>();
    for (const stop of trail.stops) {
      for (const u of stop.unlocks) {
        if (u.personId === myId) continue;
        found.set(u.personId, (found.get(u.personId) ?? 0) + 1);
      }
    }
    return {
      kind: 'creator',
      total: trail.total,
      people: [...found]
        .map(([personId, n]) => ({ personId, found: n, finished: n >= trail.total }))
        .sort((a, b) => b.found - a.found),
    };
  }

  // Stops are earned in order, so count from stop 1 until the first gap.
  let found = 0;
  let finishedAt: number | null = null;
  for (let step = 1; step <= trail.total; step++) {
    const mine = trail.stops.find((s) => s.step === step)?.unlocks.find((u) => u.personId === myId);
    if (!mine) break;
    found = step;
    finishedAt = mine.at;
  }

  const finished = found >= trail.total;
  const nextStep = finished ? null : found + 1;
  const previous = trail.stops.find((s) => s.step === found);

  return {
    kind: 'finder',
    found,
    total: trail.total,
    finished,
    finishedAt: finished ? finishedAt : null,
    next:
      nextStep == null
        ? null
        : {
            step: nextStep,
            visible: trail.stops.some((s) => s.step === nextStep),
            clue: previous?.nextClue ?? null,
          },
  };
}
