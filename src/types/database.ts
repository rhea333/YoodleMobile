/**
 * Hand-written database types for Yoodle.
 *
 * Shaped like Supabase's generated types (`Database['public']['Tables'][T]`)
 * so `createClient<Database>` gives typed queries, and so this file can later
 * be replaced by `supabase gen types typescript` without changing call sites.
 *
 * SECURITY NOTE — one deliberate asymmetry: `jobs.location` (the exact point)
 * appears in `Insert`/`Update` but NOT in `Row`. Column-level `SELECT` on that
 * column is revoked from `anon` and `authenticated` in migration 0003, so it is
 * genuinely not readable over the client SDK. Reading it requires the
 * `job_exact_location` RPC, which checks that you are the poster or the
 * accepted worker. Keeping it out of `Row` means a component cannot even ask.
 */

/** Postgres `timestamptz`, serialised as an ISO 8601 string over the wire. */
export type Timestamptz = string;

/** A `uuid` column. */
export type Uuid = string;

export type JobStatus = 'draft' | 'published' | 'assigned' | 'completed' | 'cancelled';

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

/**
 * A point as the client sees it. The database stores
 * `extensions.geography(Point, 4326)`; over PostgREST that would arrive as WKB
 * hex, which is useless client-side, so the coarse point is also mirrored onto
 * plain `coarse_lat` / `coarse_long` columns by a trigger.
 */
export type LatLong = {
  lat: number;
  long: number;
};

export type ProfileRow = {
  id: Uuid;
  display_name: string | null;
  avatar_url: string | null;
  /**
   * Forward Sortation Area ("M5V") — the neighbourhood-level form. The full
   * `postal_code` is deliberately absent from `Row`: column-level SELECT on it
   * is revoked from clients in migration 0008, exactly as with `jobs.location`.
   */
  postal_fsa: string | null;
  bio: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type ProfileInsert = {
  id: Uuid;
  display_name?: string | null;
  avatar_url?: string | null;
  postal_code?: string | null;
  bio?: string | null;
};

export type ProfileUpdate = {
  display_name?: string | null;
  avatar_url?: string | null;
  /** Write-only: full code in, FSA out. See `ProfileRow.postal_fsa`. */
  postal_code?: string | null;
  bio?: string | null;
};

export type JobRow = {
  id: Uuid;
  poster_id: Uuid;
  title: string;
  description: string | null;
  category: string;
  /** CAD. `numeric(10,2)` — PostgREST returns it as a number. */
  budget: number | null;
  /**
   * Neighbourhood-level point, rounded from the exact location by a trigger.
   * This is the only location any client can read.
   */
  coarse_lat: number | null;
  coarse_long: number | null;
  status: JobStatus;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type JobInsert = {
  poster_id: Uuid;
  title: string;
  description?: string | null;
  category: string;
  budget?: number | null;
  /** WKT, e.g. `SRID=4326;POINT(-79.3832 43.6532)`. Write-only; see file header. */
  location?: string | null;
  status?: JobStatus;
};

export type JobUpdate = {
  title?: string;
  description?: string | null;
  category?: string;
  budget?: number | null;
  location?: string | null;
  status?: JobStatus;
};

export type OfferRow = {
  id: Uuid;
  job_id: Uuid;
  worker_id: Uuid;
  amount: number;
  status: OfferStatus;
  created_at: Timestamptz;
};

export type OfferInsert = {
  job_id: Uuid;
  worker_id: Uuid;
  amount: number;
  status?: OfferStatus;
};

export type OfferUpdate = {
  amount?: number;
  status?: OfferStatus;
};

export type MessageRow = {
  id: Uuid;
  job_id: Uuid;
  sender_id: Uuid;
  /**
   * Added beyond the original spec. Without it, every worker who made an offer
   * on a job could read every other worker's conversation with the poster,
   * because `job_id` alone cannot separate threads.
   */
  recipient_id: Uuid;
  body: string;
  created_at: Timestamptz;
};

export type MessageInsert = {
  job_id: Uuid;
  sender_id: Uuid;
  recipient_id: Uuid;
  body: string;
};

export type ReviewRow = {
  id: Uuid;
  job_id: Uuid;
  reviewer_id: Uuid;
  reviewee_id: Uuid;
  /** 1–5, enforced by a CHECK constraint. */
  rating: number;
  comment: string | null;
  created_at: Timestamptz;
};

export type ReviewInsert = {
  job_id: Uuid;
  reviewer_id: Uuid;
  reviewee_id: Uuid;
  rating: number;
  comment?: string | null;
};

export type ReviewUpdate = {
  rating?: number;
  comment?: string | null;
};

/** One row of `public.nearby_jobs(...)`. */
export type NearbyJobRow = {
  id: Uuid;
  title: string;
  category: string;
  budget: number | null;
  status: JobStatus;
  lat: number;
  long: number;
  distance_meters: number;
};

export type Database = {
  public: {
    Tables: {
      // `Relationships` is required by supabase-js's type machinery; without it
      // `.update()` narrows to `never`. Empty is correct here: we do not rely on
      // PostgREST's embedded-resource inference anywhere yet.
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      jobs: { Row: JobRow; Insert: JobInsert; Update: JobUpdate; Relationships: [] };
      offers: { Row: OfferRow; Insert: OfferInsert; Update: OfferUpdate; Relationships: [] };
      // `Update: Record<string, never>` rather than `never`: messages are
      // immutable (no UPDATE policy, and the privilege is revoked in 0005), but
      // `never` fails supabase-js's GenericTable constraint, which silently
      // collapses EVERY table's Update type to `never` — not just this one.
      messages: {
        Row: MessageRow;
        Insert: MessageInsert;
        Update: Record<string, never>;
        Relationships: [];
      };
      reviews: { Row: ReviewRow; Insert: ReviewInsert; Update: ReviewUpdate; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      nearby_jobs: {
        Args: { p_lat: number; p_long: number; p_radius_meters: number };
        Returns: NearbyJobRow[];
      };
      job_exact_location: {
        Args: { p_job_id: Uuid };
        Returns: LatLong[];
      };
    };
    Enums: {
      job_status: JobStatus;
      offer_status: OfferStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
