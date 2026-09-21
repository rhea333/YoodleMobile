import { Text, View } from 'react-native';

import { StarRating, type StarRatingSize } from './StarRating';

/**
 * Whether the rating is known.
 *
 * THREE STATES, NOT TWO. "Loading", "we could not find out" and "this person
 * genuinely has no reviews" are different facts, and collapsing the first two
 * into the third makes the component assert something false. `ready` is the
 * only state in which anything is claimed about the person.
 */
export type RatingState = 'ready' | 'loading' | 'unavailable';

export interface RatingSummaryProps {
  /** Null when this profile has no reviews yet. NOT zero — zero is not a rating. */
  average: number | null;
  count: number;
  /**
   * Defaults to `ready`. Callers driving this from a query should pass
   * `loading` while it is pending and `unavailable` when it errored — passing
   * neither means the `average`/`count` given are the truth.
   */
  state?: RatingState;
  size?: StarRatingSize;
  /** Hides the stars and shows only "4.8 · 12 reviews". For dense rows. */
  compact?: boolean;
  testID?: string;
}

/**
 * A profile's reputation in one line.
 *
 * "No reviews yet" IS THE POINT OF THE NULL CASE. An unrated person must not
 * render as zero stars: on a marketplace where strangers decide whether to let
 * each other into their homes, "new" and "badly rated" are opposite signals,
 * and showing an empty five-star row for both is actively misleading.
 *
 * The same argument is why `state` exists. A pending or failed read has no
 * business rendering "No reviews yet" either — that is a claim about the
 * person, and a well-reviewed worker should never be described as unrated
 * because a query was slow or a network dropped. Unknown renders as unknown.
 */
export const RatingSummary = ({
  average,
  count,
  state = 'ready',
  size = 'sm',
  compact = false,
  testID,
}: RatingSummaryProps) => {
  if (state === 'loading') {
    // A muted placeholder rather than nothing, so the row does not reflow when
    // the real value lands.
    return (
      <Text className="text-footnote text-text-muted" testID={testID}>
        ★ …
      </Text>
    );
  }

  if (state === 'unavailable') {
    // Silence. A failed read is not worth a line of apology on every card, and
    // it must not read as a statement about this person.
    return null;
  }

  if (average === null || count === 0) {
    return (
      <Text className="text-footnote text-text-muted" testID={testID}>
        No reviews yet
      </Text>
    );
  }

  const plural = count === 1 ? 'review' : 'reviews';

  if (compact) {
    return (
      <Text className="text-footnote text-text-secondary" testID={testID}>
        <Text className="text-warning">★</Text> {average.toFixed(1)} · {count} {plural}
      </Text>
    );
  }

  return (
    <View
      accessibilityLabel={`Rated ${average.toFixed(1)} out of 5 from ${count} ${plural}`}
      className="flex-row items-center gap-xs"
      testID={testID}
    >
      <StarRating size={size} value={average} />
      <Text className="text-footnote font-medium text-text-primary">{average.toFixed(1)}</Text>
      <Text className="text-footnote text-text-muted">
        ({count} {plural})
      </Text>
    </View>
  );
};
