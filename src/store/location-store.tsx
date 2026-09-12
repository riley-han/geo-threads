import { createContext, useContext, useState, type ReactNode } from 'react';

import { DEFAULT_POSITION } from '@/data/places';
import type { Geofence, LatLng } from '@/lib/geo';

/** Far from every seeded fence, so any message reads as locked. */
const FAR_AWAY: LatLng = { latitude: 34.0522, longitude: -118.2437 };

type LocationApi = {
  position: LatLng;
  jumpInside: (fence: Geofence) => void;
  jumpFarAway: () => void;
};

const LocationContext = createContext<LocationApi | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<LatLng>(DEFAULT_POSITION);

  const jumpInside = (fence: Geofence) =>
    setPosition({ latitude: fence.latitude, longitude: fence.longitude });

  const jumpFarAway = () => setPosition(FAR_AWAY);

  return (
    <LocationContext.Provider value={{ position, jumpInside, jumpFarAway }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationApi {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('LocationProvider is missing');
  return ctx;
}

export function useCurrentPosition(): LatLng {
  return useLocation().position;
}
