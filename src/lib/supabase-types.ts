/**
 * Domain aliases over the generated Supabase types.
 *
 * These live here and not in `database.types.ts` because that file is
 * overwritten wholesale by `npm run db:types` — anything hand-written in it is
 * lost on the next regeneration.
 *
 * Import row types from here; import `Database` itself from the generated file.
 */

import type { Database } from '@/lib/database.types';

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type InsertTables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];
export type UpdateTables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
export type Functions<T extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][T];

export type ProfileRow = Tables<'profiles'>;
export type FriendshipRow = Tables<'friendships'>;
export type ConversationRow = Tables<'conversations'>;
export type ConversationParticipantRow = Tables<'conversation_participants'>;
export type MessageRow = Tables<'messages'>;
export type MessageUnlockRow = Tables<'message_unlocks'>;
export type FriendshipStatus = Enums<'friendship_status'>;
