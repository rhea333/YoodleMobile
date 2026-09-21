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
  /**
   * When the user last completed or skipped onboarding, or null if they never
   * have. This is a different question from whether `avatar_url` and `bio` are
   * filled in: both are optional, so their absence cannot stand in for it.
   */
  onboarded_at: Timestamptz | null;
  /**
   * Whether Stripe will let this user receive transfers. Mirrored from Stripe
   * by the `account.updated` webhook and re-checked server-side before any
   * payout, so it is a hint for the UI, never the authority.
   */
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

/**
 * NOTE ON WHAT IS ABSENT: `profiles.stripe_account_id` exists in the database
 * but not here, on purpose and by the same rule as `jobs.location`. SELECT on
 * it is revoked from every client role in migration 0017, so naming it in a
 * query would fail the whole request. Keeping it out of `Row` means a component
 * cannot ask for it in the first place.
 */

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
  onboarded_at?: Timestamptz | null;
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
  /**
   * Storage paths in the `job-photos` bucket, max 3. Paths, not URLs — see the
   * note in migration 0014. Never null; the column defaults to an empty array.
   */
  photo_paths: string[];
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
  photo_paths?: string[];
};

export type JobUpdate = {
  title?: string;
  description?: string | null;
  category?: string;
  budget?: number | null;
  location?: string | null;
  status?: JobStatus;
  photo_paths?: string[];
};

export type OfferRow = {
  id: Uuid;
  job_id: Uuid;
  worker_id: Uuid;
  amount: number;
  status: OfferStatus;
  /** Optional note the worker sent with the bid. Sanitised; capped at 1000. */
  message: string | null;
  created_at: Timestamptz;
  /**
   * Set by trigger on every write (0016). Client-unwritable, and used to give
   * each status transition its own identity — without it, declined -> re-bid ->
   * declined collapses into one notification.
   */
  updated_at: Timestamptz;
};

export type OfferInsert = {
  job_id: Uuid;
  worker_id: Uuid;
  amount: number;
  status?: OfferStatus;
  message?: string | null;
};

export type OfferUpdate = {
  amount?: number;
  status?: OfferStatus;
  message?: string | null;
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

/**
 * One row of `public.profile_ratings` — the aggregate rating view (0018).
 *
 * A profile with no reviews has NO ROW here rather than a row of zeroes. That
 * is the honest shape: zero is not a valid rating, and "unrated" is a different
 * statement from "rated badly". Callers treat a missing row as "no reviews
 * yet".
 *
 * `rating_avg` is `numeric` in Postgres and arrives as a JSON NUMBER. An
 * earlier version of this type claimed it was a string, on the theory that
 * PostgREST quotes numerics to protect their precision. It does not — it emits
 * them unquoted. The lie was harmless because the only reader coerces with
 * `Number()`, but it type-checked any future string method into a runtime
 * crash, which is exactly the failure a hand-written type is supposed to stop.
 */
export type ProfileRatingRow = {
  profile_id: Uuid;
  rating_avg: number | null;
  rating_count: number;
};

/**
 * One row of `public.browse_jobs(...)` — the paginated browse read.
 *
 * `lat`/`long` are the COARSE point, rounded to ~1 km. There is deliberately no
 * field here for the exact one: it is not in the function's result and its
 * column is not readable, so a browse screen cannot render a precise pin even
 * by mistake. Reaching the exact point requires `job_exact_location`, which is
 * for the poster and the accepted worker only.
 */
export type BrowseJobRow = {
  id: Uuid;
  poster_id: Uuid;
  title: string;
  description: string | null;
  category: string;
  budget: number | null;
  lat: number;
  long: number;
  distance_meters: number;
  created_at: Timestamptz;
};

/** One row of `public.nearby_job_categories(...)`, for the filter chips. */
export type JobCategoryCount = {
  category: string;
  job_count: number;
};

/**
 * The lifecycle of a payment. Ordered as it happens:
 *
 *   requires_payment_method -> requires_action -> authorized -> captured -> released
 *
 * `authorized` is the one worth understanding: the card is HELD, nothing has
 * been taken. `captured` means the payer has actually been charged. `released`
 * means the money reached the worker's connected account — only
 * stripe-release-payment sets that, because only it knows the transfer landed.
 */
export type PaymentStatus =
  | 'requires_payment_method'
  | 'requires_action'
  | 'authorized'
  | 'captured'
  | 'released'
  | 'failed'
  | 'canceled';

/**
 * A payment as the CLIENT may see it.
 *
 * The Stripe object ids (`stripe_payment_intent_id`, `stripe_charge_id`,
 * `stripe_transfer_id`) and `last_error` are columns on the table that are
 * deliberately not granted to any client role, so they are absent here too.
 * The app shows a status; Stripe's internal identifiers stay server-side.
 *
 * No Insert or Update type exists for this table, and that is not an omission:
 * there is no client write path to payments at all. Every row is written by an
 * Edge Function using the service role.
 */
export type PaymentRow = {
  id: Uuid;
  job_id: Uuid;
  offer_id: Uuid;
  payer_id: Uuid;
  payee_id: Uuid;
  /** Integer cents. Stripe's unit, stored rather than recomputed per read. */
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  authorized_at: Timestamptz | null;
  released_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
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
      // Read-only from the client. `Record<string, never>` rather than `never`
      // for Insert/Update, for the reason spelled out on `messages`: `never`
      // collapses EVERY table's write types, not just this one.
      payments: {
        Row: PaymentRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: {
      // Read-only by construction: a grouped view is not updatable, and only
      // SELECT is granted (0018). `Record<string, never>` for the write types
      // for the same reason spelled out on `messages` — `never` would collapse
      // every table's write types, not just this one.
      profile_ratings: {
        Row: ProfileRatingRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Functions: {
      job_exact_location: {
        Args: { p_job_id: Uuid };
        Returns: LatLong[];
      };
      browse_jobs: {
        Args: {
          p_lat: number;
          p_long: number;
          p_radius_meters?: number;
          p_category?: string | null;
          p_search?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: BrowseJobRow[];
      };
      nearby_job_categories: {
        Args: { p_lat: number; p_long: number; p_radius_meters?: number };
        Returns: JobCategoryCount[];
      };
    };
    Enums: {
      job_status: JobStatus;
      offer_status: OfferStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
