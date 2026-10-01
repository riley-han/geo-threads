import { supabase } from '@/lib/supabase';

import { describeError } from './errors';

/**
 * Stores this device's Expo push token for the signed-in user. The RPC also
 * removes the token from any other account that last used the device.
 */
export async function savePushToken(
  token: string,
  platform: 'ios' | 'android',
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: platform,
  });
  return { error: error ? describeError(error) : null };
}

/** RLS limits the delete to the caller's own rows, so run it before sign-out. */
export async function deletePushToken(token: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  return { error: error ? describeError(error) : null };
}
