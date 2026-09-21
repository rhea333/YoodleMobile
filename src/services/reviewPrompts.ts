import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Uuid } from '../types/database';

/**
 * "I already dismissed the review prompt for this job."
 *
 * Device state, not server state. Whether somebody wants to be asked again is
 * a UI preference, not a fact about the transaction, and it does not belong in
 * a table other people can read.
 *
 * NOT A SECURITY CONTROL, AND NOT A DUPLICATE GUARD. AsyncStorage is
 * unencrypted, clearable by the user, and per-device. What stops a second
 * review is `reviews_one_per_job_per_reviewer` in the database; what stops the
 * prompt reappearing after a review is written is the review row itself. This
 * only remembers a DISMISSAL — the case where no row exists and none is coming.
 *
 * Nothing sensitive is stored: a key namespaced by user id, and job ids. No
 * ratings, no comments, no names.
 *
 * THE NAMESPACING IS THE ISOLATION, and it removes the need for a wipe on sign
 * out: a second account on this device reads its own key and cannot see the
 * first one's. Clearing on sign-out would discard only the departing user's own
 * dismissals, so prompts they had deliberately dismissed would come back the
 * next time they signed in.
 */

/** Namespaced by user so a second account on one device starts clean. */
const keyFor = (userId: Uuid): string => `yoodle.reviewPrompt.dismissed.${userId}`;

/**
 * Read the dismissed set for a user.
 *
 * Every failure resolves to an empty set rather than throwing. A storage read
 * that fails should mean "show the prompt" — being asked once more is a far
 * smaller problem than a screen that will not render.
 */
const readDismissed = async (userId: Uuid): Promise<Set<string>> => {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return new Set();

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
};

/** Has this user dismissed the prompt for this job? */
export const isReviewPromptDismissed = async (userId: Uuid, jobId: Uuid): Promise<boolean> => {
  const dismissed = await readDismissed(userId);
  return dismissed.has(jobId);
};

/**
 * Remember that this user dismissed the prompt for this job.
 *
 * Read-modify-write, which is safe here because dismissals come from taps —
 * one at a time, on one device. Returns false if the write failed, which the
 * caller may ignore: the prompt reappearing is the correct failure mode.
 */
export const dismissReviewPrompt = async (userId: Uuid, jobId: Uuid): Promise<boolean> => {
  try {
    const dismissed = await readDismissed(userId);
    dismissed.add(jobId);
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify([...dismissed]));
    return true;
  } catch {
    return false;
  }
};
