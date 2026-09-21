import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Button,
  Card,
  Chip,
  RatingSummary,
  ReviewCard,
  type RatingState,
} from '../components';
import {
  usePosterQuery,
  useProfileRatingQuery,
  useReviewsForProfileQuery,
  useSession,
  useTheme,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { spacing } from '../theme';
import type { ReviewWithReviewer } from '../services';

type Props = NativeStackScreenProps<MainStackParamList, 'Profile'>;

type Tab = 'about' | 'reviews';

/**
 * Somebody's public profile: who they are, what they are rated, what people said.
 *
 * WHAT IS DELIBERATELY NOT HERE: anything the column grants from 0008 do not
 * return. No email, no full postal code, no job history. A profile read gives
 * display name, photo, bio and FSA, and that is the whole of what this screen
 * can render no matter whose profile it is — the restriction is in the grant,
 * not in this file.
 *
 * Reviews are public (`reviews_select_all`, 0006), which is the point of them:
 * a rating nobody can see before agreeing to meet a stranger is not doing any
 * work. The reviews list is fetched only when its tab is opened.
 */
export const ProfileScreen = ({ route }: Props) => {
  const { userId } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session } = useSession();

  const [tab, setTab] = useState<Tab>('about');

  const profile = usePosterQuery(userId);
  const rating = useProfileRatingQuery(userId);
  const reviews = useReviewsForProfileQuery(userId, tab === 'reviews');

  // Handled by the component rather than a local branch, so that the error case
  // is covered too — this screen previously guarded `isPending` by hand and
  // would have shown a failed read as "No reviews yet".
  const ratingState: RatingState = rating.isError
    ? 'unavailable'
    : rating.isPending
      ? 'loading'
      : 'ready';

  const isSelf = session?.user.id === userId;

  if (profile.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (profile.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-lg">
        <Text className="text-center text-body text-text-secondary">{profile.error.message}</Text>
        <View className="mt-lg">
          <Button label="Try again" onPress={() => void profile.refetch()} variant="secondary" />
        </View>
      </View>
    );
  }

  const person = profile.data;
  const name = person.display_name ?? 'A neighbour';

  const header = (
    <View>
      <Card padding="md" variant="outlined">
        <View className="flex-row items-center">
          <Avatar
            name={person.display_name ?? undefined}
            size="xl"
            uri={person.avatar_url ?? undefined}
          />
          <View className="ml-lg flex-1">
            <Text className="text-title font-semibold text-text-primary">{name}</Text>
            {person.postal_fsa ? (
              <Text className="mt-px text-footnote text-text-secondary">
                {person.postal_fsa} area
              </Text>
            ) : null}
            <View className="mt-sm">
              <RatingSummary
                average={rating.data?.average ?? null}
                count={rating.data?.count ?? 0}
                size="sm"
                state={ratingState}
              />
            </View>
          </View>
        </View>
      </Card>

      {/*
        Chips rather than a tab bar component: this is two options on one
        screen, and the app already uses Chip for exactly this kind of
        single-choice row on Browse.
      */}
      <View className="mt-lg flex-row gap-sm">
        <Chip label="About" onPress={() => setTab('about')} selected={tab === 'about'} />
        <Chip
          count={rating.data?.count}
          label="Reviews"
          onPress={() => setTab('reviews')}
          selected={tab === 'reviews'}
        />
      </View>

      {tab === 'about' ? (
        <View className="mt-lg">
          <Card padding="md" variant="filled">
            {person.bio ? (
              <Text className="text-body text-text-secondary">{person.bio}</Text>
            ) : (
              <Text className="text-body text-text-muted">
                {isSelf ? 'You have not added a bio yet.' : `${name} has not added a bio yet.`}
              </Text>
            )}
          </Card>

          <View className="mt-md">
            <Text className="text-caption text-text-muted">
              Yoodle shows a neighbourhood, not an address.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );

  const renderReview = ({ item }: { item: ReviewWithReviewer }) => (
    <ReviewCard
      comment={item.comment}
      createdAt={item.createdAt}
      rating={item.rating}
      reviewerAvatarUrl={item.reviewerAvatarUrl}
      reviewerName={item.reviewerName}
    />
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingHorizontal: spacing.lg }}>
      <FlatList
        contentContainerStyle={{
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing['2xl'],
          gap: spacing.md,
        }}
        // The reviews list IS the screen's list; About renders inside the
        // header. One FlatList rather than a ScrollView wrapping one, which
        // React Native warns about and which breaks recycling on long lists.
        data={tab === 'reviews' ? (reviews.data ?? []) : []}
        keyExtractor={(review) => review.id}
        ListEmptyComponent={
          tab === 'reviews' ? (
            <View className="py-xl">
              {reviews.isPending ? (
                <ActivityIndicator color={colors.primary} />
              ) : reviews.isError ? (
                <Text className="text-center text-body text-text-secondary">
                  {reviews.error.message}
                </Text>
              ) : (
                <Text className="text-center text-body text-text-muted">
                  {isSelf
                    ? 'You have no reviews yet. They appear here once a job you were part of is complete.'
                    : `${name} has no reviews yet.`}
                </Text>
              )}
            </View>
          ) : null
        }
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              void rating.refetch();
              if (tab === 'reviews') void reviews.refetch();
            }}
            refreshing={rating.isRefetching || reviews.isRefetching}
            tintColor={colors.primary}
          />
        }
        renderItem={renderReview}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};
