import * as Location from 'expo-location';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import type { Geofence, LatLng } from '@/lib/geo';
import {
  getLocationAccess,
  requestBackgroundAccess,
  requestForegroundAccess,
  type LocationAccess,
} from '@/lib/location-permissions';

/** Far from every seeded fence, so any message reads as locked. */
const FAR_AWAY: LatLng = { latitude: 34.0522, longitude: -118.2437 };

type LocationApi = {
  /** Null until a fix arrives, or while access is withheld. Callers must fail closed. */
  position: LatLng | null;
  access: LocationAccess;
  requestForeground: () => Promise<LocationAccess>;
  requestBackground: () => Promise<LocationAccess>;
  /** Dev override — shadows GPS so unlock states are testable without moving. */
  simulated: LatLng | null;
  jumpInside: (fence: Geofence) => void;
  jumpFarAway: () => void;
  stopSimulating: () => void;
};

const LocationContext = createContext<LocationApi | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<LocationAccess>('none');
  const [gpsPosition, setGpsPosition] = useState<LatLng | null>(null);
  const [simulated, setSimulated] = useState<LatLng | null>(null);

  useEffect(() => {
    void getLocationAccess().then(setAccess);
  }, []);

  // Watch only while granted and the app is actually in front of the user.
  useEffect(() => {
    if (access !== 'foreground' && access !== 'background') return;

    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;

    const start = async () => {
      if (subscription || cancelled) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 10_000 },
        ({ coords }) =>
          setGpsPosition({ latitude: coords.latitude, longitude: coords.longitude }),
      );
      if (cancelled) {
        subscription.remove();
        subscription = undefined;
      }
    };

    const stop = () => {
      subscription?.remove();
      subscription = undefined;
    };

    if (AppState.currentState === 'active') void start();

    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void start();
        // The user may have changed permissions in Settings while we were away.
        void getLocationAccess().then(setAccess);
      } else {
        stop();
      }
    });

    return () => {
      cancelled = true;
      listener.remove();
      stop();
    };
  }, [access]);

  const requestForeground = async () => {
    const next = await requestForegroundAccess();
    setAccess(next);
    return next;
  };

  const requestBackground = async () => {
    const next = await requestBackgroundAccess();
    setAccess(next);
    return next;
  };

  return (
    <LocationContext.Provider
      value={{
        position: simulated ?? gpsPosition,
        access,
        requestForeground,
        requestBackground,
        simulated,
        jumpInside: (fence) =>
          setSimulated({ latitude: fence.latitude, longitude: fence.longitude }),
        jumpFarAway: () => setSimulated(FAR_AWAY),
        stopSimulating: () => setSimulated(null),
      }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationApi {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('LocationProvider is missing');
  return ctx;
}

export function useCurrentPosition(): LatLng | null {
  return useLocation().position;
}
