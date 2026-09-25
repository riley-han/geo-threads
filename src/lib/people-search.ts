import type { Person } from '@/data/types';

/**
 * Filters an already-loaded set of people. This is the compose path, which is
 * restricted to accepted friends — they are in memory already, so narrowing
 * them costs nothing and must not become a network call per keystroke.
 *
 * Searching for strangers is a different problem with a different answer:
 * `searchProfiles` in the repository, which queries the server.
 */
export function filterPeople(
  people: Person[],
  query: string,
  excludeIds: string[] = [],
): Person[] {
  const q = query.trim().toLowerCase();
  const excluded = new Set(excludeIds);

  return people.filter((p) => {
    if (excluded.has(p.id)) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q);
  });
}
