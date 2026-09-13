import * as Location from 'expo-location';
import { Linking } from 'react-native';

/**
 * One status covering the tiered opt-in:
 *   none       — never asked
 *   foreground — "While Using": live unlock with the app open
 *   background — "Always": adds geofencing and arrival notifications
 *   denied     — declined; only recoverable through system Settings
 */
export type LocationAccess = 'none' | 'foreground' | 'background' | 'denied';

export async function getLocationAccess(): Promise<LocationAccess> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status === 'denied' && !foreground.canAskAgain) return 'denied';
  if (foreground.status !== 'granted') return 'none';

  const background = await Location.getBackgroundPermissionsAsync();
  return background.status === 'granted' ? 'background' : 'foreground';
}

export async function requestForegroundAccess(): Promise<LocationAccess> {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  if (status === 'granted') return 'foreground';
  return canAskAgain ? 'none' : 'denied';
}

/**
 * Only meaningful after foreground has been granted — iOS will not offer
 * "Always" to an app that has not first been allowed "While Using".
 */
export async function requestBackgroundAccess(): Promise<LocationAccess> {
  const { status, canAskAgain } = await Location.requestBackgroundPermissionsAsync();
  if (status === 'granted') return 'background';
  return canAskAgain ? 'foreground' : 'foreground';
}

export function openSystemSettings(): void {
  void Linking.openSettings();
}
