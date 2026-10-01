import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deletePushToken, savePushToken } from '@/data/repository';
import { hasNotificationAccess } from '@/lib/notifications';

/**
 * Remote push registration. The server side is the `push` Edge Function, which
 * reads `push_tokens` to reach people who do not have the app open.
 *
 * Every function here fails soft. Push is an extra channel, so a missing EAS
 * project, a simulator without APNs or a network blip costs a notification,
 * never a crash or an error in front of the user.
 */

/** The token this device last registered, so sign-out can remove exactly it. */
let registeredToken: string | null = null;

function easProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Registers this device for the signed-in user. Call after notification access
 * is granted, and on sign-in when it already is. Never prompts.
 */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  // Set by `eas init`. Without it Expo cannot issue a token at all.
  const projectId = easProjectId();
  if (!projectId) return;

  try {
    if (!(await hasNotificationAccess())) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    // The RPC also takes the token away from any other account that last used
    // this device, so a shared phone only receives the current account's pushes.
    const { error } = await savePushToken(token, Platform.OS);
    if (error) {
      console.warn('[push] could not register token', error);
      return;
    }
    registeredToken = token;
  } catch (e) {
    console.warn('[push] registration skipped', e instanceof Error ? e.message : e);
  }
}

/**
 * Removes this device's token. Must run while the session still exists: RLS
 * only lets you delete your own rows, so after sign-out the delete is refused.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;

  const { error } = await deletePushToken(token);
  if (error) console.warn('[push] could not remove token', error);
}

/**
 * APNs and FCM can roll a token while the app runs; the old one stops working.
 * Re-registers on change. Returns the unsubscribe.
 */
export function watchPushToken(): () => void {
  const sub = Notifications.addPushTokenListener(() => {
    void registerPushToken();
  });
  return () => sub.remove();
}
