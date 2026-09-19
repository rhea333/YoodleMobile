import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

/**
 * The centre point for the job radius search.
 *
 * Device location rather than the profile's postal code, because nothing maps
 * a Forward Sortation Area to a coordinate yet.
 *
 * TWO PRIVACY DECISIONS are baked in here rather than left to call sites:
 *
 *   1. ACCURACY IS REQUESTED LOW ON PURPOSE. `Accuracy.Low` is ~1 km, which is
 *      all a neighbourhood radius search needs. Asking for `High` would collect
 *      a street-level fix the app then throws away — more precision than the
 *      feature uses is just a larger thing to leak.
 *   2. THE FIX IS ROUNDED BEFORE IT LEAVES THIS HOOK, to 2 decimal places
 *      (~1 km), the same grid job locations are coarsened onto in migration
 *      0003. So the centre sent to the server is a neighbourhood, not a
 *      doorstep, and the server never sees a precise user position.
 *
 * Rounding has a second, unrelated benefit: the coordinates are stable as the
 * user walks around, so they make a usable TanStack Query key instead of
 * invalidating the cache on every GPS tick.
 */

export type BrowseLocationStatus = 'loading' | 'ready' | 'denied' | 'error';

export interface Coordinates {
  lat: number;
  long: number;
}

export interface BrowseLocationState {
  status: BrowseLocationStatus;
  /** Rounded to ~1 km. Null until `status` is `ready`. */
  coords: Coordinates | null;
  /** User-facing explanation when the status is `denied` or `error`. */
  message: string | null;
  /** Re-request. Useful after the user grants permission in Settings. */
  retry: () => void;
}

/** ~1 km at Canadian latitudes — the same grid job locations are snapped to. */
const roundToNeighbourhood = (value: number): number => Math.round(value * 100) / 100;

export const useBrowseLocation = (): BrowseLocationState => {
  const [status, setStatus] = useState<BrowseLocationStatus>('loading');
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;

    const resolve = async () => {
      setStatus('loading');
      setMessage(null);

      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!active) {
          return;
        }

        if (!permission.granted) {
          setStatus('denied');
          setMessage(
            'Yoodle needs your location to show jobs nearby. You can turn this on in Settings.',
          );
          return;
        }

        // A cached fix first: it is usually instant, and good enough once
        // rounded to a 1 km grid. Only fall back to a live fix if there is
        // none, so the common case does not wait on the GPS.
        const position =
          (await Location.getLastKnownPositionAsync({})) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));

        if (!active) {
          return;
        }

        setCoords({
          lat: roundToNeighbourhood(position.coords.latitude),
          long: roundToNeighbourhood(position.coords.longitude),
        });
        setStatus('ready');
      } catch {
        if (!active) {
          return;
        }
        setStatus('error');
        setMessage('Could not work out where you are. Check that location is on, then try again.');
      }
    };

    void resolve();

    return () => {
      active = false;
    };
  }, [attempt]);

  return { status, coords, message, retry };
};
