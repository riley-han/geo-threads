import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { MirroredMessage } from '@/db/fence-mirror';

export const ARRIVAL_CHANNEL = 'arrivals';
/** Remote pushes: new messages and receipts. Must match the push Edge Function. */
export const MESSAGES_CHANNEL = 'messages';

/** Set at module scope so the handler exists before any notification can land. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationAccess(): Promise<boolean> {
  if (Platform.OS === 'android') {
    // Android 13+ requires the channel to exist before the permission prompt.
    await Notifications.setNotificationChannelAsync(ARRIVAL_CHANNEL, {
      name: 'Arrivals',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(MESSAGES_CHANNEL, {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return status === 'granted';
}

/** Whether notifications are already allowed, without prompting. */
export async function hasNotificationAccess(): Promise<boolean> {
  return (await notificationAccess()) === 'granted';
}

/**
 * 'blocked' means the OS will not show the prompt again, so only Settings can
 * turn notifications on. 'off' means asking still works.
 */
export async function notificationAccess(): Promise<'granted' | 'off' | 'blocked'> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  return canAskAgain ? 'off' : 'blocked';
}

/**
 * Composes the arrival alert for one place. Deliberately never includes message
 * text — the reader is in range, but a lock screen is not.
 *
 * Takes mirrored rows rather than Messages: this runs in a background task with
 * no session and no store, so the sender's name has to have been denormalised
 * into SQLite ahead of time. Nothing here can look anything up.
 */
export async function notifyArrival(
  messages: MirroredMessage[],
  placeLabel: string,
): Promise<void> {
  if (messages.length === 0) return;

  const single = messages.length === 1 ? messages[0] : undefined;
  const senderName = single ? single.senderName || 'Someone' : undefined;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: single ? senderName! : placeLabel,
      body: single
        ? `Unlocked a message at ${placeLabel}`
        : `${messages.length} messages unlocked here`,
      data: single
        ? { conversationId: single.conversationId, placeLabel }
        : { placeLabel },
      sound: 'default',
      interruptionLevel: 'timeSensitive',
      ...(Platform.OS === 'android' ? { channelId: ARRIVAL_CHANNEL } : {}),
    },
    trigger: null,
  });
}
