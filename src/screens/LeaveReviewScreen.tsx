import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, Card, StarRating, TextInput } from '../components';
import {
  useMyReviewForJobQuery,
  usePosterQuery,
  useReviewEligibilityQuery,
  useSession,
  useSubmitReviewMutation,
  useTheme,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { MAX_REVIEW_COMMENT_LENGTH } from '../services';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<MainStackParamList, 'LeaveReview'>;

/** Wording for the star the person has landed on. Silence at zero. */
const RATING_WORDS: Record<number, string> = {
  1: 'Poor',
  2: 'Not great',
  3: 'Fine',
  4: 'Good',
  5: 'Excellent',
};

/**
 * Leave a rating and a note about the other party on a completed job.
 *
 * THE SCREEN IS HANDED A JOB ID AND NOTHING ELSE. Who gets reviewed is derived
 * from the job and its accepted offer, never passed in — a route param naming
 * the reviewee would be a caller-supplied claim about who you worked with, and
 * this screen would be writing reputation based on it. The database would still
 * refuse a forged one (`reviews_insert_counterparty`), but the app should not
 * be asking the question in the first place.
 *
 * Everything this screen enforces is enforced again in Postgres: job complete,
 * caller is a party, one review per job. See migration 0018.
 */
export const LeaveReviewScreen = ({ navigation, route }: Props) => {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;

  const eligibility = useReviewEligibilityQuery(jobId, userId);
  const existing = useMyReviewForJobQuery(jobId, userId);

  const counterpartyId = eligibility.data?.counterpartyId ?? undefined;
  // `usePosterQuery` reads any profile by id through the 0008 column grants; the
  // name is historical, the query is not poster-specific.
  const counterparty = usePosterQuery(counterpartyId);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingError, setRatingError] = useState<string | null>(null);

  const submit = useSubmitReviewMutation({
    onSuccess: () => navigation.goBack(),
  });

  const handleSubmit = () => {
    setRatingError(null);

    if (rating < 1) {
      setRatingError('Choose a rating from 1 to 5 stars.');
      return;
    }

    if (!userId || !counterpartyId) {
      return;
    }

    submit.mutate({
      jobId,
      reviewerId: userId,
      revieweeId: counterpartyId,
      rating,
      comment,
    });
  };

  const loading = eligibility.isPending || existing.isPending;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const notEligible = eligibility.data?.counterpartyId == null;
  const alreadyReviewed = existing.data != null;

  // Both dead ends get the same shape: say why, offer the way out, and do not
  // render a form that cannot be submitted.
  if (notEligible || alreadyReviewed) {
    return (
      <View className="flex-1 justify-center bg-background p-lg">
        <Card padding="md" variant="outlined">
          <Text className="text-title font-semibold text-text-primary">
            {alreadyReviewed ? 'You have already reviewed this job' : 'This job cannot be reviewed'}
          </Text>
          <Text className="mt-sm text-body text-text-secondary">
            {alreadyReviewed
              ? 'Each person leaves one review per job. Thanks for the feedback you already left.'
              : (eligibility.data?.reason ??
                eligibility.error?.message ??
                'This job is not available to review.')}
          </Text>
        </Card>
        <View className="mt-lg">
          <Button fullWidth label="Back" onPress={() => navigation.goBack()} variant="secondary" />
        </View>
      </View>
    );
  }

  const name = counterparty.data?.display_name ?? 'this neighbour';
  const roleWord = eligibility.data?.counterpartyRole === 'poster' ? 'poster' : 'worker';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing['2xl'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card padding="sm" variant="outlined">
          <View className="flex-row items-center">
            <Avatar
              name={counterparty.data?.display_name ?? undefined}
              size="lg"
              uri={counterparty.data?.avatar_url ?? undefined}
            />
            <View className="ml-md flex-1">
              <Text className="text-bodyLarge font-semibold text-text-primary">{name}</Text>
              <Text className="mt-px text-footnote text-text-secondary">
                The {roleWord} on {eligibility.data?.jobTitle ?? 'this job'}
              </Text>
            </View>
          </View>
        </Card>

        <Text className="mb-sm mt-xl text-title font-semibold text-text-primary">How was it?</Text>

        <View className="flex-row items-center gap-md">
          <StarRating onChange={setRating} size="lg" value={rating} />
          {rating > 0 ? (
            <Text className="text-body text-text-secondary">{RATING_WORDS[rating]}</Text>
          ) : null}
        </View>

        {ratingError ? (
          <Text className="mt-sm text-footnote text-danger">{ratingError}</Text>
        ) : null}

        <View className="mt-xl">
          <TextInput
            helperText={`Optional. ${comment.length}/${MAX_REVIEW_COMMENT_LENGTH}`}
            label="Anything to add?"
            maxLength={MAX_REVIEW_COMMENT_LENGTH}
            multiline
            onChangeText={setComment}
            placeholder={
              roleWord === 'worker'
                ? 'Turned up on time and cleared the whole driveway.'
                : 'Clear instructions and paid straight away.'
            }
            value={comment}
          />
        </View>

        <View className="mt-lg">
          <Card padding="sm" variant="filled">
            <Text className="text-caption text-text-muted">
              Reviews are public and permanent, and shown on {name}&rsquo;s profile. You can leave
              one review per job.
            </Text>
          </Card>
        </View>

        {submit.error ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-danger">{submit.error.message}</Text>
            </Card>
          </View>
        ) : null}

        <View className="mt-xl gap-md">
          <Button
            fullWidth
            label="Submit review"
            loading={submit.isPending}
            onPress={handleSubmit}
            size="lg"
          />
          <Button
            disabled={submit.isPending}
            fullWidth
            label="Cancel"
            onPress={() => navigation.goBack()}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
