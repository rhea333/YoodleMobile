import type { BrowseJobRow, JobCategoryCount, JobRow, Uuid } from '../types/database';
import { supabase } from './supabase';

/**
 * Job reads for the browse experience. Read-only this phase — there is no
 * posting or applying here yet.
 *
 * LOCATION, once, because it is the thing most easily got wrong later:
 * everything in this file reads the COARSE point (`coarse_lat`/`coarse_long`,
 * rounded to ~1 km). The exact `location` column has SELECT revoked from every
 * client role, and neither `browse_jobs` nor the detail read below returns it.
 * A pin on the map is a neighbourhood, never an address. The exact point comes
 * from `job_exact_location()` and only for the poster or the accepted worker —
 * which is an offers-phase concern, not this one.
 */

/** Page size the browse list asks for. The server clamps to 1..50 regardless. */
export const BROWSE_PAGE_SIZE = 20;

/** Default browse radius. Also the server's fallback when none is sent. */
export const DEFAULT_RADIUS_METERS = 10_000;

/**
 * Server-side ceilings, mirrored here only so the UI can explain them. These
 * are NOT the enforcement — `browse_jobs` clamps every one of them itself, so
 * a caller that ignores these values gains nothing. See migration 0011.
 */
export const MAX_RADIUS_METERS = 50_000;
export const MAX_BROWSE_OFFSET = 500;

export interface ServiceFailure {
  ok: false;
  message: string;
}

export interface BrowseJobsParams {
  lat: number;
  long: number;
  radiusMeters?: number;
  /** Exact category match, or null/undefined for "all". */
  category?: string | null;
  /** Free text over title and description. Wildcards are escaped server-side. */
  search?: string | null;
  limit?: number;
  offset?: number;
}

export type BrowseJobsResult = { ok: true; jobs: BrowseJobRow[] } | ServiceFailure;

/**
 * One page of nearby published jobs, nearest first.
 *
 * Returns a page rather than a cursor because the underlying function is
 * offset-paged. That is safe here only because its ORDER BY is a total order
 * (distance, then created_at, then id) — coarse rounding puts many jobs at an
 * identical distance, and without the tiebreak pages would overlap and skip.
 */
export const browseJobs = async (params: BrowseJobsParams): Promise<BrowseJobsResult> => {
  const { data, error } = await supabase.rpc('browse_jobs', {
    p_lat: params.lat,
    p_long: params.long,
    p_radius_meters: params.radiusMeters ?? DEFAULT_RADIUS_METERS,
    p_category: params.category ?? null,
    p_search: params.search?.trim() ? params.search.trim() : null,
    p_limit: params.limit ?? BROWSE_PAGE_SIZE,
    p_offset: params.offset ?? 0,
  });

  if (error) {
    return { ok: false, message: 'Could not load jobs near you. Please try again.' };
  }

  return { ok: true, jobs: data ?? [] };
};

export type JobCategoriesResult = { ok: true; categories: JobCategoryCount[] } | ServiceFailure;

/**
 * The categories that actually have jobs in range, with counts.
 *
 * Derived from the data rather than from a fixed list so the chips can never
 * offer a filter that returns an empty list, and so there is no taxonomy to
 * keep in sync with whatever posters end up typing.
 */
export const getNearbyJobCategories = async (
  lat: number,
  long: number,
  radiusMeters: number = DEFAULT_RADIUS_METERS,
): Promise<JobCategoriesResult> => {
  const { data, error } = await supabase.rpc('nearby_job_categories', {
    p_lat: lat,
    p_long: long,
    p_radius_meters: radiusMeters,
  });

  if (error) {
    return { ok: false, message: 'Could not load categories.' };
  }

  return { ok: true, categories: data ?? [] };
};

/**
 * Columns the detail screen reads. `location` is absent and must stay absent —
 * SELECT on it is revoked, so naming it here would fail the whole query rather
 * than silently leak, but the intent is worth stating.
 */
const JOB_DETAIL_COLUMNS =
  'id, poster_id, title, description, category, budget, coarse_lat, coarse_long, status, created_at, updated_at';

export type JobResult = { ok: true; job: JobRow } | ServiceFailure;

/**
 * A single job by id.
 *
 * RLS decides visibility: a published job is readable by anyone, and a poster
 * can additionally read their own drafts. That is correct for a detail screen
 * reached by id — unlike the browse list, where a poster's own drafts appearing
 * among real listings would be wrong.
 */
export const getJobById = async (jobId: Uuid): Promise<JobResult> => {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_DETAIL_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: 'Could not load this job. Please try again.' };
  }

  if (!data) {
    return { ok: false, message: 'This job is no longer available.' };
  }

  return { ok: true, job: data };
};

/** Metres to a short human string: "450 m away", "2.3 km away". */
export const formatDistance = (meters: number): string => {
  if (!Number.isFinite(meters) || meters < 0) {
    return 'Nearby';
  }

  if (meters < 1000) {
    // Rounded to 50 m. The underlying point is only accurate to ~1 km anyway,
    // so a figure like "437 m" would imply a precision that does not exist.
    const rounded = Math.max(50, Math.round(meters / 50) * 50);
    return `${rounded} m away`;
  }

  return `${(meters / 1000).toFixed(1)} km away`;
};

/** CAD, with no cents when there are none. */
export const formatBudget = (budget: number | null): string | null => {
  if (budget === null || !Number.isFinite(budget)) {
    return null;
  }
  return Number.isInteger(budget) ? `$${budget}` : `$${budget.toFixed(2)}`;
};
