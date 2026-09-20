import type { ProfileRow, ProfileUpdate, Uuid } from '../types/database';
import { prepareImageForUpload, readLocalFileBytes } from './images';
import { supabase } from './supabase';

/**
 * Profile reads and writes. Like every other Supabase call in the app, these
 * live in /src/services and are never inlined into a component.
 *
 * Note on the postal code: callers write the FULL code and read back only
 * `postal_fsa`. That asymmetry is enforced by the database (migration 0008
 * revokes column-level SELECT on `postal_code`), not by convention here.
 */

/** Columns a client is actually permitted to read. Keep in sync with 0008. */
const PROFILE_COLUMNS =
  'id, display_name, avatar_url, postal_fsa, bio, onboarded_at, created_at, updated_at';

export const AVATAR_BUCKET = 'avatars';

/**
 * Upload limits, enforced here BEFORE any bytes leave the device.
 *
 * Storage enforces the same ceiling and MIME allow-list server-side (see
 * migration 0009), so a client that bypasses this still cannot abuse the
 * bucket. This copy exists to fail fast and to give a usable error message
 * instead of a rejected multipart upload.
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const ALLOWED_AVATAR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export type AllowedAvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];

/** The subset of an expo-image-picker asset this service needs. */
export interface PickedImage {
  uri: string;
  mimeType?: string;
  fileSize?: number;
  fileName?: string;
}

export interface AvatarValidationFailure {
  ok: false;
  message: string;
}

export interface AvatarValidationSuccess {
  ok: true;
  mimeType: AllowedAvatarMimeType;
  extension: string;
}

export type AvatarValidation = AvatarValidationSuccess | AvatarValidationFailure;

const EXTENSION_BY_MIME: Record<AllowedAvatarMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

const isAllowedMime = (value: string): value is AllowedAvatarMimeType =>
  (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(value);

/** Only consulted when the picker could not determine a MIME type itself. */
const MIME_BY_EXTENSION: Record<string, AllowedAvatarMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
};

const mimeFromUri = (uri: string): AllowedAvatarMimeType | undefined => {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(uri)?.[1]?.toLowerCase();
  return extension ? MIME_BY_EXTENSION[extension] : undefined;
};

/**
 * Validate a picked image by declared type and size.
 *
 * `mimeType` and `fileSize` are both OPTIONAL in expo-image-picker's result —
 * the SDK 57 types document the MIME type as absent "if could not be
 * determined", and asset metadata is routinely missing under iOS's limited
 * photo-library permission. Treating either absence as a rejection stranded
 * those users behind a "please pick another" that no other photo would fix, so
 * each one now degrades instead:
 *
 *   - no MIME type -> fall back to the URI extension;
 *   - no file size -> skip the check here, because `uploadMyAvatar` measures
 *     the real bytes after reading them anyway.
 *
 * A DECLARED type outside the allow-list is still rejected outright; the
 * extension is only a fallback, never an override. All of this is a
 * client-side declaration that a modified client could forge, which is why the
 * bucket enforces the same ceiling and allow-list itself (migration 0009).
 */
export const validateAvatar = (image: PickedImage): AvatarValidation => {
  const declared = image.mimeType?.toLowerCase();
  let mimeType: AllowedAvatarMimeType | undefined;

  if (declared !== undefined) {
    if (!isAllowedMime(declared)) {
      return { ok: false, message: 'Please choose a JPEG, PNG, WebP or HEIC image.' };
    }
    mimeType = declared;
  } else {
    mimeType = mimeFromUri(image.uri);
  }

  if (!mimeType) {
    return {
      ok: false,
      message: 'Could not tell what kind of image that is. Please pick another.',
    };
  }

  if (image.fileSize !== undefined) {
    if (image.fileSize === 0) {
      return { ok: false, message: 'That file appears to be empty. Please pick another.' };
    }

    if (image.fileSize > MAX_AVATAR_BYTES) {
      const mb = (image.fileSize / (1024 * 1024)).toFixed(1);
      return { ok: false, message: `That image is ${mb} MB. Please choose one under 5 MB.` };
    }
  }

  return { ok: true, mimeType, extension: EXTENSION_BY_MIME[mimeType] };
};

/**
 * Canadian postal code validation, mirroring the CHECK constraint in migration
 * 0008. Canada Post never uses D, F, I, O, Q or U in any position, nor W or Z
 * in the first — so `A1A 1A1` alone is too loose a test.
 *
 * Accepts an optional space or hyphen in the middle and any case; the caller
 * normalises before sending.
 */
const POSTAL_CODE_PATTERN = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

export const isValidPostalCode = (value: string): boolean => POSTAL_CODE_PATTERN.test(value.trim());

/** `m5v2t6` / `m5v 2t6` -> `M5V 2T6`. Returns null when not a valid code. */
export const normalisePostalCode = (value: string): string | null => {
  const compact = value.replace(/[\s-]+/g, '').toUpperCase();
  if (!POSTAL_CODE_PATTERN.test(compact)) {
    return null;
  }
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
};

export interface ServiceFailure {
  ok: false;
  message: string;
}

export type ProfileResult = { ok: true; profile: ProfileRow } | ServiceFailure;

/** The signed-in user's own profile. */
export const getMyProfile = async (userId: Uuid): Promise<ProfileResult> => {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();

  if (error || !data) {
    return { ok: false, message: 'Could not load your profile. Please try again.' };
  }

  return { ok: true, profile: data };
};

/**
 * Any user's profile, by id.
 *
 * Used for the poster summary on a job detail screen. `profiles_select_authenticated`
 * lets any signed-in user read any profile row, but only through the column
 * grants from 0008 — so this returns a display name, photo, bio and FSA, and
 * cannot return the full postal code no matter who asks.
 *
 * `maybeSingle` rather than `single`: a job whose poster row has gone is a
 * missing summary, not an error worth failing the screen over.
 */
export const getProfileById = async (userId: Uuid): Promise<ProfileResult> => {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: 'Could not load that profile.' };
  }

  return { ok: true, profile: data };
};

/**
 * Patch the signed-in user's profile.
 *
 * RLS restricts this to the caller's own row, and column grants restrict it to
 * display_name / avatar_url / postal_code / bio — so a forged `id` in the patch
 * cannot reassign the row, and `postal_fsa` cannot be desynced from
 * `postal_code`.
 *
 * A successful UPDATE that matches no row returns zero rows rather than an
 * error, which is how RLS denials surface. That is treated as a failure here;
 * see SECURITY.md.
 */
export const updateMyProfile = async (
  userId: Uuid,
  patch: ProfileUpdate,
): Promise<ProfileResult> => {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(PROFILE_COLUMNS);

  if (error) {
    return { ok: false, message: 'Could not save your profile. Please try again.' };
  }

  const row = data?.[0];
  if (!row) {
    // Zero rows from an UPDATE means no row was visible/writable to us.
    return { ok: false, message: 'Could not save your profile — please sign in again.' };
  }

  return { ok: true, profile: row };
};

export type AvatarUploadResult = { ok: true; publicUrl: string; path: string } | ServiceFailure;

/**
 * Validate, strip metadata, upload, and record a new avatar.
 *
 * The object path is `{userId}/avatar.jpg`. The leading folder is what the
 * storage policies in 0009 check against `auth.uid()`, so one user can never
 * overwrite another's file. `upsert` is on so re-uploading replaces rather than
 * accumulating orphans.
 *
 * EXIF: the picked file is re-encoded through `prepareImageForUpload` before
 * any bytes are uploaded. This replaces the previous reliance on the picker's
 * `exif: false`, which only suppressed EXIF in the object returned to
 * JavaScript and left the file — and therefore the upload — carrying whatever
 * the camera wrote, GPS included, into a PUBLIC bucket. See SECURITY.md.
 *
 * Because re-encoding always produces JPEG, the extension is now fixed at
 * `.jpg` rather than mirroring the source format. An avatar uploaded before
 * this change may still sit at `avatar.png`; it stays referenced by its row
 * until that user uploads again.
 */
export const uploadMyAvatar = async (
  userId: Uuid,
  image: PickedImage,
): Promise<AvatarUploadResult> => {
  const validation = validateAvatar(image);
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  // Re-encode BEFORE reading any bytes, so what gets uploaded is the stripped
  // copy and there is no path where the original file reaches Storage.
  const prepared = await prepareImageForUpload(image.uri);
  if (!prepared.ok) {
    return { ok: false, message: prepared.message };
  }

  const body = await readLocalFileBytes(prepared.image.uri);
  if (!body) {
    return { ok: false, message: 'Could not read that image from your device.' };
  }

  // The ACTUAL bytes, not the picker's claim about them — and the only size
  // check that runs at all when the picker gave us no `fileSize`.
  if (body.byteLength === 0) {
    return { ok: false, message: 'That file appears to be empty. Please pick another.' };
  }

  if (body.byteLength > MAX_AVATAR_BYTES) {
    return { ok: false, message: 'That image is too large. Please choose one under 5 MB.' };
  }

  const path = `${userId}/avatar.${prepared.image.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, body, { contentType: prepared.image.mimeType, upsert: true });

  if (uploadError) {
    return { ok: false, message: 'Could not upload that photo. Please try again.' };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);

  // Cache-bust: the path is stable across re-uploads, so without this the old
  // image would keep being served from cache.
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;

  const saved = await updateMyProfile(userId, { avatar_url: versionedUrl });
  if (!saved.ok) {
    return { ok: false, message: saved.message };
  }

  return { ok: true, publicUrl: versionedUrl, path };
};
