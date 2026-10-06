import type { TrailRevealMode } from '@/data/types';

/**
 * Starting points for the trail builder. A template fills in the title, mode,
 * hint delay and number of stops, and gives each stop prompts (placeholders,
 * not text): the creator still picks every place and writes every note.
 */
export type TrailTemplate = {
  id: string;
  name: string;
  /** One line under the chip. */
  description: string;
  title: string;
  revealMode: TrailRevealMode;
  hintAfterMinutes: number | null;
  stops: { bodyPrompt: string; cluePrompt?: string; timeTip?: string }[];
};

export const TRAIL_TEMPLATES: TrailTemplate[] = [
  {
    id: 'birthday',
    name: 'Birthday hunt',
    description: 'Clues lead from surprise to surprise, ending at the party.',
    title: 'Birthday hunt',
    revealMode: 'clue',
    hintAfterMinutes: 360,
    stops: [
      { bodyPrompt: 'Happy birthday! The hunt starts here…', cluePrompt: 'Your next clue: somewhere you…' },
      { bodyPrompt: 'A memory or a small surprise for this spot', cluePrompt: 'Next, head to where we…' },
      { bodyPrompt: 'Another surprise', cluePrompt: 'Almost there. Find the place that…' },
      { bodyPrompt: 'One more before the finale', cluePrompt: 'Last clue: the party is at…' },
      {
        bodyPrompt: 'The finale: everyone is waiting for you',
        timeTip: 'Set an opening time so the finale lands when the party starts.',
      },
    ],
  },
  {
    id: 'our-places',
    name: 'Our places',
    description: 'A walk through the places that matter to the two of you.',
    title: 'Our places',
    revealMode: 'pin',
    hintAfterMinutes: null,
    stops: [
      { bodyPrompt: 'Where we first met. What do you remember?', cluePrompt: 'Optional: a hint at our first date' },
      { bodyPrompt: 'Our first date', cluePrompt: 'Optional: a hint at where we always end up' },
      { bodyPrompt: 'The place we always end up' },
      { bodyPrompt: 'Somewhere new, for the next chapter' },
    ],
  },
  {
    id: 'city-walk',
    name: 'City walk',
    description: 'Six spots worth seeing, with a note at each.',
    title: 'City walk',
    revealMode: 'pin',
    hintAfterMinutes: null,
    stops: Array.from({ length: 6 }, (_, i) => ({
      bodyPrompt: i === 0 ? 'Start here. What makes this spot worth it?' : 'Why stop here?',
      cluePrompt: i < 5 ? 'Optional: which way next?' : undefined,
    })),
  },
];
