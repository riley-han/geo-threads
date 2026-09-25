import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { MirroredMessage } from '@/db/fence-mirror';

export const ARRIVAL_CHANNEL = 'arrivals';

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
  }
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return status === 'granted';
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
