import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Prepare a picked image for upload: re-encode it, which is what actually
 * removes EXIF.
 *
 * WHY THIS EXISTS, because the previous approach looked right and was not:
 *
 * The picker's `exif: false` option does NOT strip metadata from the file. The
 * SDK 57 docs describe it as "whether to also include the EXIF data for the
 * image" — it controls whether EXIF is handed to JavaScript as a field on the
 * returned asset. The bytes on disk are untouched, so an upload still carries
 * whatever the camera wrote, including `GPSLatitude`/`GPSLongitude`.
 *
 * That matters more here than almost anywhere else in this app. Yoodle rounds
 * job locations to ~1 km and revokes SELECT on the exact point specifically so
 * a browser cannot learn where someone lives. A photo of the driveway, taken at
 * the driveway, with GPS EXIF intact, hands over the address the schema spent
 * two migrations protecting — and the job-photos bucket is public.
 *
 * Re-encoding is the fix. `ImageManipulator` decodes the image to a bitmap and
 * writes a NEW file from those pixels; metadata from the source is not part of
 * that pipeline, so it does not survive. The SDK 57 docs do not state this
 * explicitly, which is why TESTING.md carries a manual check that inspects an
 * uploaded file for an EXIF marker rather than taking it on trust.
 *
 * The resize is not cosmetic either: a full-resolution phone photo is several
 * megabytes, and 1600px is beyond what any screen here displays.
 */

/** Longest edge after resizing. Comfortably above display size on any phone. */
const MAX_DIMENSION = 1600;

/** JPEG quality. High enough that a listing photo still looks good. */
const COMPRESSION = 0.8;

export interface PreparedImage {
  /** Local URI of the re-encoded copy. Always JPEG. */
  uri: string;
  width: number;
  height: number;
  /** Always `image/jpeg` — re-encoding normalises the format as well. */
  mimeType: 'image/jpeg';
  extension: 'jpg';
}

export interface ImagePrepFailure {
  ok: false;
  message: string;
}

export type PrepareImageResult = { ok: true; image: PreparedImage } | ImagePrepFailure;

/**
 * Re-encode an image from a local URI, stripping metadata and capping its size.
 *
 * Returns a discriminated result rather than throwing, matching every other
 * service in this project.
 */
export const prepareImageForUpload = async (uri: string): Promise<PrepareImageResult> => {
  try {
    // Render first, because the source dimensions are not known until it is
    // decoded — and both decisions below depend on them.
    const original = await ImageManipulator.manipulate(uri).renderAsync();
    const longestEdge = Math.max(original.width, original.height);

    // Resize ONLY when the image is actually too big. An unconditional
    // `resize({ width })` did two wrong things: it upscaled small images (a
    // 200x200 avatar became 1600x1600 — larger than the source and blurry),
    // and because it constrains WIDTH it let a portrait photo through at
    // 1600x2133, above the cap it was supposed to enforce.
    //
    // Constraining the longer side keeps the aspect ratio and makes
    // MAX_DIMENSION mean what it says.
    const resized =
      longestEdge > MAX_DIMENSION
        ? await ImageManipulator.manipulate(original)
            .resize(
              original.width >= original.height
                ? { width: MAX_DIMENSION }
                : { height: MAX_DIMENSION },
            )
            .renderAsync()
        : original;

    // Note this runs even when no resize happened: the re-encode is what
    // strips EXIF, so it must not be skipped just because the image was small.
    const saved = await resized.saveAsync({
      format: SaveFormat.JPEG,
      compress: COMPRESSION,
    });

    return {
      ok: true,
      image: {
        uri: saved.uri,
        width: saved.width,
        height: saved.height,
        mimeType: 'image/jpeg',
        extension: 'jpg',
      },
    };
  } catch {
    return { ok: false, message: 'Could not process that image. Please try another.' };
  }
};

/**
 * Read a local file into an ArrayBuffer for upload.
 *
 * The documented React Native path — Blob and FormData are unreliable under
 * Hermes. Shared by the avatar and job-photo uploads so there is one place this
 * can go wrong.
 */
export const readLocalFileBytes = async (uri: string): Promise<ArrayBuffer | null> => {
  try {
    return await fetch(uri).then((response) => response.arrayBuffer());
  } catch {
    return null;
  }
};
