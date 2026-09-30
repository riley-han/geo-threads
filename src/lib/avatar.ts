/**
 * Avatar presentation. Lives in lib/ rather than with the data layer because
 * none of it depends on where a person came from — it turns an id into a colour
 * and a name into initials, and nothing else.
 */

/**
 * Indigo Lake companions, each dark enough to carry white initials in both
 * themes. The order is part of the contract: `colorForId` indexes into it, so
 * reordering repaints everyone.
 */
export const AVATAR_COLORS = [
  '#3D63B8', // ai (indigo)
  '#B04A6C', // sakura
  '#946115', // ichō (ginkgo)
  '#4E7F4A', // koke (moss)
  '#7A5294', // fuji (wisteria)
  '#1A7872', // glacier
  '#B34A31', // momiji (maple)
  '#5D6B82', // slate
] as const;

export const AVATAR_TEXT = '#FFFFFF';

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
