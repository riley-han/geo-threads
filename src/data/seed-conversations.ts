import { ME_ID } from './contacts';
import { PRESET_PLACES } from './places';
import type { Conversation, Message } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = Date.now();

const place = (name: string) => PRESET_PLACES.find((p) => p.name === name)!;

const ferryBuilding = place('Ferry Building');
const pier39 = place('Pier 39');
const dolores = place('Dolores Park');

export const SEED_CONVERSATIONS: Conversation[] = [
  { id: 'c-ada', participantIds: ['ada'], isGroup: false, unread: true },
  { id: 'c-miguel', participantIds: ['miguel'], isGroup: false, unread: false },
  { id: 'c-priya', participantIds: ['priya'], isGroup: false, unread: true },
  {
    id: 'c-fenwick',
    participantIds: ['theo', 'amara', 'elena'],
    isGroup: true,
    title: 'Fenwick Trail Crew',
    unread: true,
  },
  { id: 'c-jonas', participantIds: ['jonas'], isGroup: false, unread: false },
  { id: 'c-naomi', participantIds: ['naomi'], isGroup: false, unread: false },
  { id: 'c-chidera', participantIds: ['chidera'], isGroup: false, unread: false },
  { id: 'c-elena', participantIds: ['elena'], isGroup: false, unread: false },
  { id: 'c-theo', participantIds: ['theo'], isGroup: false, unread: false },
  { id: 'c-amara', participantIds: ['amara'], isGroup: false, unread: false },
  { id: 'c-ren', participantIds: ['ren'], isGroup: false, unread: false },
  { id: 'c-sana', participantIds: ['sana'], isGroup: false, unread: false },
];

export const SEED_MESSAGES: Message[] = [
  // Ada — includes a fence that CONTAINS the default position (renders unlocked).
  {
    id: 'm-ada-1',
    conversationId: 'c-ada',
    senderId: 'ada',
    body: 'Morning! Are you near the water today?',
    sentAt: NOW - 3 * HOUR,
  },
  {
    id: 'm-ada-2',
    conversationId: 'c-ada',
    senderId: ME_ID,
    body: 'Yeah, walking the Embarcadero right now',
    sentAt: NOW - 3 * HOUR + 4 * MINUTE,
  },
  {
    id: 'm-ada-3',
    conversationId: 'c-ada',
    senderId: 'ada',
    body: 'Perfect. The key is taped under the third bench from the clock tower.',
    sentAt: NOW - 2 * HOUR,
    fence: {
      latitude: ferryBuilding.latitude,
      longitude: ferryBuilding.longitude,
      radiusMeters: 300,
      label: 'Ferry Building',
    },
  },
  {
    id: 'm-ada-4',
    conversationId: 'c-ada',
    senderId: 'ada',
    body: 'Sending over the map now — new pin dropped near the pier.',
    sentAt: NOW - 40 * MINUTE,
  },

  // Miguel — plain thread, last message outgoing.
  {
    id: 'm-miguel-1',
    conversationId: 'c-miguel',
    senderId: 'miguel',
    body: 'Still good for lunch?',
    sentAt: NOW - 5 * HOUR,
  },
  {
    id: 'm-miguel-2',
    conversationId: 'c-miguel',
    senderId: ME_ID,
    body: 'on my way, ETA 10',
    sentAt: NOW - 4 * HOUR,
  },

  // Priya — fence far from the default position (renders locked).
  {
    id: 'm-priya-1',
    conversationId: 'c-priya',
    senderId: 'priya',
    body: 'Heading up north this afternoon.',
    sentAt: NOW - 9 * HOUR,
  },
  {
    id: 'm-priya-2',
    conversationId: 'c-priya',
    senderId: 'priya',
    body: 'Table is booked under my sister’s name, ask for the back patio.',
    sentAt: NOW - 8 * HOUR,
    fence: {
      latitude: pier39.latitude,
      longitude: pier39.longitude,
      radiusMeters: 200,
      label: 'Pier 39',
    },
  },
  {
    id: 'm-priya-3',
    conversationId: 'c-priya',
    senderId: 'priya',
    body: 'Wait — is Overlook Point closed today?',
    sentAt: NOW - 7 * HOUR,
  },

  // Fenwick Trail Crew — group with a fenced message.
  {
    id: 'm-fenwick-1',
    conversationId: 'c-fenwick',
    senderId: 'theo',
    body: 'Ridge loop this weekend?',
    sentAt: NOW - 2 * DAY,
  },
  {
    id: 'm-fenwick-2',
    conversationId: 'c-fenwick',
    senderId: 'amara',
    body: 'I’m in. Weather looks clear.',
    sentAt: NOW - 2 * DAY + 20 * MINUTE,
  },
  {
    id: 'm-fenwick-3',
    conversationId: 'c-fenwick',
    senderId: 'elena',
    body: 'Gate code for the trailhead lot is 4417.',
    sentAt: NOW - 2 * DAY + 90 * MINUTE,
    fence: {
      latitude: dolores.latitude,
      longitude: dolores.longitude,
      radiusMeters: 500,
      label: 'Dolores Park',
    },
  },
  {
    id: 'm-fenwick-4',
    conversationId: 'c-fenwick',
    senderId: 'theo',
    body: 'New thread stitched together for the ridge loop.',
    sentAt: NOW - 2 * DAY + 3 * HOUR,
  },

  // Remaining threads — single message each, enough to populate the inbox.
  {
    id: 'm-jonas-1',
    conversationId: 'c-jonas',
    senderId: 'jonas',
    body: 'Got the photos, thank you 🙏',
    sentAt: NOW - DAY,
  },
  {
    id: 'm-naomi-1',
    conversationId: 'c-naomi',
    senderId: 'naomi',
    body: 'Let me know when you land in Osaka',
    sentAt: NOW - DAY - 2 * HOUR,
  },
  {
    id: 'm-chidera-1',
    conversationId: 'c-chidera',
    senderId: ME_ID,
    body: 'sounds good — send coords',
    sentAt: NOW - 3 * DAY,
  },
  {
    id: 'm-elena-1',
    conversationId: 'c-elena',
    senderId: 'elena',
    body: 'Rain moved in, might have to move the meetup',
    sentAt: NOW - 3 * DAY - 5 * HOUR,
  },
  {
    id: 'm-theo-1',
    conversationId: 'c-theo',
    senderId: 'theo',
    body: 'The waypoint you dropped works — thanks',
    sentAt: NOW - 4 * DAY,
  },
  {
    id: 'm-amara-1',
    conversationId: 'c-amara',
    senderId: 'amara',
    body: 'Draft of the itinerary is in the shared thread.',
    sentAt: NOW - 16 * DAY,
  },
  {
    id: 'm-ren-1',
    conversationId: 'c-ren',
    senderId: 'ren',
    body: 'Camera roll synced. Let me know what to keep.',
    sentAt: NOW - 18 * DAY,
  },
  {
    id: 'm-sana-1',
    conversationId: 'c-sana',
    senderId: 'sana',
    body: 'Signal is spotty here — will reply properly tonight.',
    sentAt: NOW - 20 * DAY,
  },
];
