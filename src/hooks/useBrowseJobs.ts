import { useInfiniteQuery, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  BROWSE_PAGE_SIZE,
  DEFAULT_RADIUS_METERS,
  MAX_BROWSE_OFFSET,
  browseJobs,
  getNearbyJobCategories,
} from '../services';
import type { BrowseJobRow, JobCategoryCount } from '../types/database';
import type { Coordinates } from './useBrowseLocation';

/**
 * Server state for the browse screen. As in phase 3, the services return
 * discriminated results and the hooks convert a `{ ok: false }` into a thrown
 * error, which is what Query needs to populate `error`.
 */

export const jobKeys = {
  all: ['jobs'] as const,
  browse: (coords: Coordinates, radiusMeters: number, category: string | null, search: string) =>
    ['jobs', 'browse', coords.lat, coords.long, radiusMeters, category, search] as const,
  categories: (coords: Coordinates, radiusMeters: number) =>
    ['jobs', 'categories', coords.lat, coords.long, radiusMeters] as const,
  detail: (jobId: string) => ['jobs', 'detail', jobId] as const,
};

export interface UseBrowseJobsParams {
  coords: Coordinates | null;
  radiusMeters?: number;
  category?: string | null;
  search?: string;
}

/**
 * Paginated nearby jobs.
 *
 * `getNextPageParam` stops at `MAX_BROWSE_OFFSET` for a reason that is easy to
 * miss: the server CLAMPS an over-large offset rather than erroring, so asking
 * for offset 520 when the ceiling is 500 quietly returns the offset-500 page
 * again. Paging past the cap would therefore append duplicate rows to the list
 * forever. Stopping here is what turns the anti-scrape cap into a clean end of
 * list instead of a bug.
 */
export const useBrowseJobs = ({
  coords,
  radiusMeters = DEFAULT_RADIUS_METERS,
  category = null,
  search = '',
}: UseBrowseJobsParams) =>
  useInfiniteQuery({
    queryKey: coords
      ? jobKeys.browse(coords, radiusMeters, category, search)
      : ['jobs', 'browse', 'no-location'],
    enabled: coords !== null,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<BrowseJobRow[]> => {
      if (!coords) {
        throw new Error('No location yet.');
      }

      const result = await browseJobs({
        lat: coords.lat,
        long: coords.long,
        radiusMeters,
        category,
        search,
        limit: BROWSE_PAGE_SIZE,
        offset: pageParam,
      });

      if (!result.ok) {
        throw new Error(result.message);
      }

      return result.jobs;
    },
    getNextPageParam: (lastPage, allPages) => {
      // A short page is the last page.
      if (lastPage.length < BROWSE_PAGE_SIZE) {
        return undefined;
      }

      const nextOffset = allPages.reduce((count, page) => count + page.length, 0);

      // See the note above: past the cap the server repeats a page.
      if (nextOffset >= MAX_BROWSE_OFFSET) {
        return undefined;
      }

      return nextOffset;
    },
  });

export const useNearbyCategories = (
  coords: Coordinates | null,
  radiusMeters: number = DEFAULT_RADIUS_METERS,
): UseQueryResult<JobCategoryCount[], Error> =>
  useQuery({
    queryKey: coords ? jobKeys.categories(coords, radiusMeters) : ['jobs', 'categories', 'none'],
    enabled: coords !== null,
    queryFn: async (): Promise<JobCategoryCount[]> => {
      if (!coords) {
        throw new Error('No location yet.');
      }
      const result = await getNearbyJobCategories(coords.lat, coords.long, radiusMeters);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.categories;
    },
  });

/**
 * Delays a fast-changing value. Used for the search box so that typing does not
 * fire a query — and a fresh page-1 fetch — on every keystroke.
 */
export const useDebouncedValue = <T>(value: T, delayMs = 300): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};
