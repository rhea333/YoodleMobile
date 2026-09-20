import type {
  BrowseJobRow,
  JobCategoryCount,
  JobRow,
  JobStatus,
  JobUpdate,
  Uuid,
} from '../types/database';
import { prepareImageForUpload, readLocalFileBytes } from './images';
import { MIN_JOB_TITLE_LENGTH, sanitizeJobDescription, sanitizeJobTitle } from './sanitize';
import { supabase } from './supabase';

/**
 * Job reads and writes: browsing (phase 4), posting and managing (phase 5).
 * Applying is still not here — offers are a later phase.
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
  'id, poster_id, title, description, category, budget, coarse_lat, coarse_long, status, photo_paths, created_at, updated_at';

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

// ---------------------------------------------------------------------------
// Posting and managing. Everything below is phase 5.
// ---------------------------------------------------------------------------

/**
 * The categories a poster can choose from.
 *
 * A fixed list rather than free text, unlike the browse filter which derives
 * its chips from whatever is actually posted. Letting posters type their own
 * would fragment the taxonomy immediately ("Dog walking", "dog-walking",
 * "Dogs") and make those chips useless. This is the single definition.
 */
export const JOB_CATEGORIES = [
  'outdoor',
  'indoor',
  'cleaning',
  'moving',
  'pets',
  'tech',
  'errands',
  'other',
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

export const JOB_PHOTO_BUCKET = 'job-photos';

/** Mirrors the CHECK constraint in migration 0014. */
export const MAX_JOB_PHOTOS = 3;

/** The public URL for a stored job photo path. */
export const jobPhotoUrl = (path: string): string =>
  supabase.storage.from(JOB_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

export interface CreateJobInput {
  posterId: Uuid;
  title: string;
  description: string;
  category: string;
  /** CAD. Must be greater than zero; validated before this is called. */
  budget: number;
  lat: number;
  long: number;
  /** Local URIs from the picker. Re-encoded and uploaded, max 3. */
  photoUris?: string[];
}

/**
 * Point to WKT for the `location` column.
 *
 * Longitude FIRST. Getting this backwards is the classic PostGIS mistake and it
 * fails silently — the job simply lands in the wrong hemisphere rather than
 * raising anything.
 */
const toWkt = (lat: number, long: number): string => `SRID=4326;POINT(${long} ${lat})`;

export type CreateJobResult = { ok: true; job: JobRow; photoWarning?: string } | ServiceFailure;

/**
 * Create a published job, then attach photos.
 *
 * TWO STEPS ON PURPOSE. Photos live at `{userId}/{jobId}/{n}.jpg`, and the job
 * id does not exist until the row does. Inserting first lets the storage path
 * carry the id, which is what makes a photo traceable to its listing. The
 * alternative — generating an id client-side — would let a caller pick its own
 * primary key.
 *
 * A photo failure does NOT fail the post. The row is already saved by that
 * point, and discarding it because an upload timed out would throw away the
 * text the user actually typed. The result reports it as a warning instead.
 */
export const createJob = async (input: CreateJobInput): Promise<CreateJobResult> => {
  // Sanitised here, not only in the screen: this is the last point every write
  // passes through, and a future caller might not be a form.
  const title = sanitizeJobTitle(input.title);
  const description = sanitizeJobDescription(input.description);

  if (title.length < MIN_JOB_TITLE_LENGTH) {
    return { ok: false, message: 'Please give the job a slightly longer title.' };
  }

  if (!(input.budget > 0)) {
    return { ok: false, message: 'Please enter a budget greater than zero.' };
  }

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      poster_id: input.posterId,
      title,
      description: description.length > 0 ? description : null,
      category: input.category,
      budget: input.budget,
      location: toWkt(input.lat, input.long),
      status: 'published',
    })
    .select(JOB_DETAIL_COLUMNS)
    .single();

  if (error || !data) {
    // The rate-limit trigger from 0014 raises check_violation with its own
    // message. Worth distinguishing: "try again later" is actionable, and
    // "something went wrong" is not.
    if (error?.message?.includes('Too many jobs posted')) {
      return {
        ok: false,
        message: 'You have posted a lot of jobs in the last hour. Please try again later.',
      };
    }
    return { ok: false, message: 'Could not post this job. Please try again.' };
  }

  const uris = (input.photoUris ?? []).slice(0, MAX_JOB_PHOTOS);
  if (uris.length === 0) {
    return { ok: true, job: data };
  }

  const uploaded = await uploadJobPhotos(input.posterId, data.id, uris);
  if (!uploaded.ok) {
    return { ok: true, job: data, photoWarning: uploaded.message };
  }

  const withPhotos = await updateJob(data.id, { photo_paths: uploaded.paths });
  if (!withPhotos.ok) {
    return {
      ok: true,
      job: data,
      photoWarning: 'Your job was posted, but the photos did not save.',
    };
  }

  return { ok: true, job: withPhotos.job };
};

export type UploadJobPhotosResult = { ok: true; paths: string[] } | ServiceFailure;

/**
 * Remove job photo objects from storage.
 *
 * Best-effort and non-fatal: the caller has already saved the row that stopped
 * referencing these, so a failure here leaves litter rather than breaking
 * anything the user can see. It returns the outcome anyway so a caller that
 * cares can log it.
 */
export const deleteJobPhotos = async (paths: string[]): Promise<{ ok: boolean }> => {
  if (paths.length === 0) {
    return { ok: true };
  }

  const { error } = await supabase.storage.from(JOB_PHOTO_BUCKET).remove(paths);
  return { ok: !error };
};

/**
 * Re-encode and upload up to 3 photos, returning their storage paths.
 *
 * Every image goes through `prepareImageForUpload` first, which re-encodes it
 * and therefore drops EXIF — including the GPS coordinates that would otherwise
 * hand over the exact address the rest of this app works to keep coarse.
 * Nothing here uploads a picked file directly.
 */
export const uploadJobPhotos = async (
  userId: Uuid,
  jobId: Uuid,
  uris: string[],
): Promise<UploadJobPhotosResult> => {
  const paths: string[] = [];
  const batch = Date.now();

  for (const [index, uri] of uris.slice(0, MAX_JOB_PHOTOS).entries()) {
    const prepared = await prepareImageForUpload(uri);
    if (!prepared.ok) {
      return { ok: false, message: prepared.message };
    }

    const body = await readLocalFileBytes(prepared.image.uri);
    if (!body || body.byteLength === 0) {
      return { ok: false, message: 'Could not read one of those photos from your device.' };
    }

    // The leading folder is what the storage policies in 0014 check against
    // auth.uid(), and what the jobs_validate_photo_paths trigger re-checks
    // before the path is recorded against the row.
    //
    // The `batch` segment makes each save write to FRESH paths. Index-only
    // names (`.../0.jpg`) were stable across saves, so with `upsert` a replaced
    // photo kept its public URL and both the image cache and the CDN carried on
    // serving the previous picture. A new path per save sidesteps caching
    // entirely — the same reason the avatar URL carries `?v=`. The objects the
    // old paths point at are then deleted by the caller; see deleteJobPhotos.
    const path = `${userId}/${jobId}/${batch}-${index}.${prepared.image.extension}`;

    const { error } = await supabase.storage
      .from(JOB_PHOTO_BUCKET)
      .upload(path, body, { contentType: prepared.image.mimeType, upsert: true });

    if (error) {
      return { ok: false, message: 'Could not upload one of those photos. Please try again.' };
    }

    paths.push(path);
  }

  return { ok: true, paths };
};

/**
 * Patch a job. RLS restricts this to the caller's own rows, and the column
 * grants in 0003 and 0014 restrict it to the editable fields.
 */
export const updateJob = async (jobId: Uuid, patch: JobUpdate): Promise<JobResult> => {
  const next: JobUpdate = { ...patch };

  if (typeof next.title === 'string') {
    next.title = sanitizeJobTitle(next.title);
  }
  if (typeof next.description === 'string') {
    const cleaned = sanitizeJobDescription(next.description);
    next.description = cleaned.length > 0 ? cleaned : null;
  }

  const { data, error } = await supabase
    .from('jobs')
    .update(next)
    .eq('id', jobId)
    .select(JOB_DETAIL_COLUMNS);

  if (error) {
    return { ok: false, message: 'Could not save your changes. Please try again.' };
  }

  const row = data?.[0];
  if (!row) {
    // Zero rows from an UPDATE is how an RLS denial surfaces — it is not
    // reported as an error. Here it means the job is not ours to edit.
    return { ok: false, message: 'You can only edit jobs you posted.' };
  }

  return { ok: true, job: row };
};

/**
 * Cancel a job. Sets the status; never deletes.
 *
 * The row is kept because offers, messages and reviews reference it, and
 * because "this job was cancelled" is something a worker who made an offer
 * needs to be able to see. `browse_jobs` filters on `status = 'published'`, so
 * cancelling removes it from browse without destroying anything.
 */
export const cancelJob = async (jobId: Uuid): Promise<JobResult> =>
  updateJob(jobId, { status: 'cancelled' });

export type MyJobsResult = { ok: true; jobs: JobRow[] } | ServiceFailure;

/**
 * Every job the user posted, newest first, in all statuses.
 *
 * Deliberately not `browse_jobs`: a poster needs to see their own drafts and
 * cancelled listings, which that function exists to hide. Visibility here comes
 * from the `jobs_select_own` RLS policy.
 */
export const listMyJobs = async (userId: Uuid): Promise<MyJobsResult> => {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_DETAIL_COLUMNS)
    .eq('poster_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, message: 'Could not load your jobs. Please try again.' };
  }

  return { ok: true, jobs: data ?? [] };
};

/** Human label for a status badge. */
export const jobStatusLabel = (status: JobStatus): string => {
  switch (status) {
    case 'published':
      return 'Open';
    case 'draft':
      return 'Draft';
    case 'assigned':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
};
