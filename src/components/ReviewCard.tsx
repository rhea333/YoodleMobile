import { Text, View } from 'react-native';

import { Avatar } from './Avatar';
import { Card } from './Card';
import { StarRating } from './StarRating';

export interface ReviewCardProps {
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewerName: string | null;
  reviewerAvatarUrl: string | null;
  testID?: string;
}

/** "14 Mar 2026". An empty string for an unparseable date rather than "Invalid Date". */
const dateOf = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * One review, as it appears on the reviewee's profile.
 *
 * The reviewer is shown by display name and photo only. There is deliberately
 * no link to the job: a review is public, and the job it came from is not
 * necessarily public — linking it would leak one party's listing history to
 * anyone reading the other's profile.
 *
 * A review with no comment renders as stars and a date, with no empty body.
 * Plenty of people rate without writing, and an empty quote block reads as
 * something having gone wrong.
 */
export const ReviewCard = ({
  rating,
  comment,
  createdAt,
  reviewerName,
  reviewerAvatarUrl,
  testID,
}: ReviewCardProps) => {
  const name = reviewerName ?? 'A neighbour';
  const date = dateOf(createdAt);

  return (
    <Card padding="sm" testID={testID} variant="outlined">
      <View className="flex-row items-center">
        <Avatar name={reviewerName ?? undefined} size="md" uri={reviewerAvatarUrl ?? undefined} />
        <View className="ml-md flex-1">
          <Text className="text-body font-semibold text-text-primary">{name}</Text>
          <View className="mt-px flex-row items-center gap-xs">
            <StarRating size="sm" value={rating} />
            {date ? <Text className="text-caption text-text-muted">{date}</Text> : null}
          </View>
        </View>
      </View>

      {comment ? <Text className="mt-md text-body text-text-secondary">{comment}</Text> : null}
    </Card>
  );
};
