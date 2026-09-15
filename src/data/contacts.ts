export type Contact = {
  id: string;
  name: string;
  handle: string;
};

export const ME_ID = 'me';

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

export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
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
