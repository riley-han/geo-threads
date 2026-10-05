/**
 * The fixed reaction set, in display order.
 *
 * Must match the check constraint on `message_reactions.emoji` in
 * supabase/migrations/20261004120000_reactions.sql — `npm run db:test` fails if
 * the two drift. Adding one means a migration as well as an edit here.
 */
export const REACTIONS = ['❤️', '😂', '😮', '🙏'] as const;

export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && (REACTIONS as readonly string[]).includes(value);
}
