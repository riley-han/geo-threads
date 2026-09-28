export type Contact = {
  id: string;
  name: string;
  handle: string;
};

export const ME_ID = 'me';

// Moved to @/lib/avatar — re-exported so existing imports keep working until
// this file is deleted along with the fixtures.
export { AVATAR_COLORS, colorForId, initialsFor } from '@/lib/avatar';

export const CONTACTS: Contact[] = [
  { id: 'ada', name: 'Ada Okafor', handle: '@ada' },
  { id: 'miguel', name: 'Miguel Santos', handle: '@miguel' },
  { id: 'priya', name: 'Priya Balachandran', handle: '@priya' },
  { id: 'jonas', name: 'Jonas Weber', handle: '@jonas' },
  { id: 'naomi', name: 'Naomi Reyes', handle: '@naomi' },
  { id: 'chidera', name: 'Chidera Umeh', handle: '@chidera' },
  { id: 'elena', name: 'Elena Kováč', handle: '@elena' },
  { id: 'theo', name: 'Theo Marchetti', handle: '@theo' },
  { id: 'amara', name: 'Amara Boateng', handle: '@amara' },
  { id: 'ren', name: 'Ren Takahashi', handle: '@ren' },
  { id: 'sana', name: 'Sana Iqbal', handle: '@sana' },
  { id: 'luca', name: 'Luca Ferrari', handle: '@luca' },
  { id: 'imani', name: 'Imani Clarke', handle: '@imani' },
  { id: 'yusuf', name: 'Yusuf Demir', handle: '@yusuf' },
  { id: 'marta', name: 'Marta Lindqvist', handle: '@marta' },
  { id: 'devon', name: 'Devon Ellis', handle: '@devon' },
  { id: 'hana', name: 'Hana Kobayashi', handle: '@hanak' },
  { id: 'omar', name: 'Omar Haddad', handle: '@omar' },
  { id: 'freya', name: 'Freya Nilsen', handle: '@freya' },
  { id: 'kwame', name: 'Kwame Mensah', handle: '@kwame' },
  { id: 'lucia', name: 'Lucia Moreno', handle: '@lucia' },
  { id: 'arjun', name: 'Arjun Nair', handle: '@arjun' },
  { id: 'nadia', name: 'Nadia Petrova', handle: '@nadia' },
  { id: 'tobias', name: 'Tobias Brandt', handle: '@tobias' },
];

const CONTACTS_BY_ID = new Map(CONTACTS.map((c) => [c.id, c]));

export function contactById(id: string): Contact | undefined {
  return CONTACTS_BY_ID.get(id);
}

function matches(contact: Contact, query: string): boolean {
  if (!query) return true;
  return (
    contact.name.toLowerCase().includes(query) || contact.handle.toLowerCase().includes(query)
  );
}

/** Everyone on the roster — backs people discovery, where strangers are the point. */
export function searchAllContacts(query: string): Contact[] {
  const q = query.trim().toLowerCase();
  return CONTACTS.filter((c) => matches(c, q));
}

/** Only the given ids — backs compose, which is restricted to accepted friends. */
export function searchWithin(
  ids: string[],
  query: string,
  excludeIds: string[] = [],
): Contact[] {
  const q = query.trim().toLowerCase();
  const allowed = new Set(ids);
  const excluded = new Set(excludeIds);
  return CONTACTS.filter(
    (c) => allowed.has(c.id) && !excluded.has(c.id) && matches(c, q),
  );
}
