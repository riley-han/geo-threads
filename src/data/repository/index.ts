/**
 * Every server read and write in the app goes through here.
 *
 * Screens and stores import from this module and never touch `supabase`
 * directly, so the data source is one seam rather than a hundred call sites —
 * which is what would make adopting a sync engine later a contained change.
 */

export { describeError, messageOf } from './errors';
export { conversationTitle, toEpochMs, toPerson } from './mappers';

export {
  createConversation,
  fetchConversation,
  fetchConversations,
  markConversationRead,
} from './conversations';

export {
  createMessage,
  fetchMessages,
  fetchPendingFenced,
  messageFromRealtimeRow,
  subscribeToMessageEvents,
  unlockMessage,
} from './messages';

export { deletePushToken, savePushToken } from './push';

export { fetchProfile, searchProfiles } from './profiles';

export {
  acceptFriendRequest,
  fetchFriendships,
  removeFriendship,
  sendFriendRequest,
  updateMyProfile,
  type Friendship,
  type FriendStatus,
} from './social';
