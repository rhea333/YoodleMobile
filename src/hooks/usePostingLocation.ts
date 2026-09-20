import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import type { Coordinates } from './useBrowseLocation';
import { useBrowseLocation } from './useBrowseLocation';

/**
 * Resolves a STARTING point for the "where is this job" pin.
 *
 * Two sources, in order:
 *
 *   1. Device GPS, via the same hook browsing uses.
 *   2. The profile's Forward Sortation Area, geocoded to a neighbourhood
 *      centroid, when GPS is unavailable or denied.
 *
 * Only a starting point — the poster drags the pin to the real spot, and that
 * dragged value is what gets saved. This is why the GPS fix being rounded to
 * ~1 km upstream does not matter here: it positions the map, it is not the
 * answer.
 *
 * `geocodeAsync` is documented as resource-consuming and rate-limited, so it
 * runs at most once per mount and only when GPS did not answer.
 */

export type PostingLocationStatus = 'loading' | 'ready' | 'unavailable';

export interface PostingLocationState {
  /** Suggested starting point, or null while resolving / if nothing worked. */
  suggested: Coordinates | null;
  status: PostingLocationStatus;
  /** Where the suggestion came from, for the UI to explain. */
  source: 'gps' | 'neighbourhood' | null;
}

export const usePostingLocation = (postalFsa: string | null | undefined): PostingLocationState => {
  const browseLocation = useBrowseLocation();
  const [fallback, setFallback] = useState<Coordinates | null>(null);
  // Whether the geocode has finished, either way. Rendered, so it is state —
  // but it is only ever set from the async callback below, never synchronously
  // in the effect body.
  const [fallbackSettled, setFallbackSettled] = useState(false);
  // Whether we have STARTED. Purely a guard against a second request, never
  // rendered, so it is a ref: writing it during the effect costs no render.
  const startedRef = useRef(false);

  const gpsSettled = browseLocation.status !== 'loading';
  const gpsCoords = browseLocation.coords;

  useEffect(() => {
    // Only reach for the geocoder once GPS has actually failed, never in
    // parallel — the fallback exists because the first source did not answer.
    if (!gpsSettled || gpsCoords || startedRef.current || !postalFsa) {
      return;
    }

    let active = true;
    startedRef.current = true;

    const resolve = async () => {
      try {
        const results = await Location.geocodeAsync(`${postalFsa}, Canada`);
        const first = results[0];
        if (active && first) {
          setFallback({ lat: first.latitude, long: first.longitude });
        }
      } catch {
        // Leave `fallback` null; the screen reports that it could not guess.
      } finally {
        if (active) {
          setFallbackSettled(true);
        }
      }
    };

    void resolve();

    return () => {
      active = false;
    };
  }, [gpsSettled, gpsCoords, postalFsa]);

  if (gpsCoords) {
    return { suggested: gpsCoords, status: 'ready', source: 'gps' };
  }

  if (fallback) {
    return { suggested: fallback, status: 'ready', source: 'neighbourhood' };
  }

  if (!gpsSettled || (postalFsa && !fallbackSettled)) {
    return { suggested: null, status: 'loading', source: null };
  }

  return { suggested: null, status: 'unavailable', source: null };
};
