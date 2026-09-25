/**
 * Avatar presentation. Lives in lib/ rather than with the data layer because
 * none of it depends on where a person came from — it turns an id into a colour
 * and a name into initials, and nothing else.
 */

export const AVATAR_COLORS = [
  '#3c87f7',
  '#e0668a',
  '#f2a94b',
  '#57c07f',
  '#a373e6',
  '#4bc0c0',
  '#ef6f6c',
  '#7a8b99',
] as const;

/**
 * The pre-UUID hash: `hash * 31 + charCode`. Kept for seeds that are not uuids —
 * a conversation id, or a locally-built placeholder.
 */
function legacyHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * A stable colour for a person.
 *
 * Note this does not hash a uuid, it reads one. `legacyHash` multiplies by 31,
 * and 31 ≡ -1 (mod 8), so `% AVATAR_COLORS.length` collapses to an alternating
 * sum of character codes — fine over short varied names, but uuids are all the
 * same length and drawn from hex only, so the positional weighting cancels and
 * the palette clusters. The last 8 hex digits of a uuid are the tail of its
 * final group, carrying no version or variant bits, so they are uniform.
 *
 * Seeded on the id and never the handle: editing your handle should not repaint
 * your avatar.
 */
export function colorForId(id: string): string {
  const tail = id.replace(/-/g, '').slice(-8);
  const parsed = Number.parseInt(tail, 16);
  const hash = Number.isNaN(parsed) ? legacyHash(id) : parsed;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Up to two initials. Returns '' for an empty name — an empty circle, not a crash. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}
