/**
 * Turning Postgres and PostgREST failures into something a person can read.
 *
 * Raw errors from RLS are not shippable: a blocked insert surfaces as
 * `new row violates row-level security policy for table "conversation_participants"`,
 * which is accurate, useless, and alarming. The mapping below is deliberately
 * small — anything unrecognised falls through to the server's own message,
 * because a wrong-but-friendly string is worse than a blunt accurate one.
 */

type PostgrestLike = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
};

/** Keeps the message and drops the rest. Shared with the auth store. */
export function messageOf(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : 'Something went wrong. Please try again.';
}

function asPostgrest(error: unknown): PostgrestLike {
  return error && typeof error === 'object' ? (error as PostgrestLike) : {};
}

/**
 * @param error   the thrown or returned PostgrestError
 * @param context what the user was trying to do, so one code can read
 *                differently depending on where it came from
 */
export function describeError(error: unknown, context?: 'message' | 'profile' | 'friend'): string {
  const { code, message } = asPostgrest(error);
  const text = typeof message === 'string' ? message : '';

  // 42501 is insufficient_privilege; a failed RLS check can also arrive as a
  // plain message with no code, so match on both.
  if (code === '42501' || text.includes('row-level security')) {
    if (text.includes('conversation_participants') || context === 'friend') {
      return 'You can only message people you have added.';
    }
    return 'You do not have access to that.';
  }

  // 23505 unique_violation
  if (code === '23505') {
    if (text.includes('profiles_handle_key')) return 'That handle is taken.';
    if (text.includes('friendships_pair_key')) return 'You are already connected.';
    return 'That already exists.';
  }

  // 23514 check_violation
  if (code === '23514') {
    if (text.includes('messages_body')) return 'That message is too long.';
    if (text.includes('profiles_handle')) {
      return 'Handles can use letters, numbers and underscores, 3 to 30 characters.';
    }
    if (text.includes('profiles_name')) return 'Enter a name.';
    return 'That value is not allowed.';
  }

  // 23503 foreign_key_violation — almost always a person who no longer exists.
  if (code === '23503') return 'That person is no longer available.';

  return messageOf(error);
}
