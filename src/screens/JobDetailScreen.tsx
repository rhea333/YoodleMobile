import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Badge, Button, Card } from '../components';
import { usePosterQuery, useJobQuery, useTheme } from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { formatBudget, jobPhotoUrl } from '../services';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<MainStackParamList, 'JobDetail'>;

/**
 * A single job, with the poster's public summary.
 *
 * WHAT IS DELIBERATELY NOT HERE: any precise location. The job read returns the
 * coarse point only, and the poster summary is limited by column grants to
 * name, photo, bio and FSA. There is no map pin and no address on this screen —
 * until an offer is accepted, a browser has no business knowing where the work
 * actually is, and this phase has no offers.
 *
 * "Apply" is an inert placeholder. It is rendered disabled rather than omitted
 * so the layout is the real one when the offers phase wires it up.
 */
export const JobDetailScreen = ({ route }: Props) => {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const jobQuery = useJobQuery(jobId);
  const posterQuery = usePosterQuery(jobQuery.data?.poster_id);

  if (jobQuery.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (jobQuery.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-lg">
        <Text className="text-center text-body text-text-secondary">{jobQuery.error.message}</Text>
        <View className="mt-lg">
          <Button label="Try again" onPress={() => void jobQuery.refetch()} variant="secondary" />
        </View>
      </View>
    );
  }

  const job = jobQuery.data;
  const budget = formatBudget(job.budget);
  const poster = posterQuery.data;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: insets.bottom + spacing['2xl'],
      }}
    >
      <Text className="text-heading font-bold text-text-primary">{job.title}</Text>

      <View className="mt-md flex-row flex-wrap items-center gap-xs">
        <Badge label={job.category} tone="neutral" />
        {budget ? <Badge label={budget} tone="primary" /> : null}
        <Badge label={job.status === 'published' ? 'Open' : job.status} tone="success" withDot />
      </View>

      {job.photo_paths.length > 0 ? (
        <ScrollView
          className="mt-lg"
          contentContainerStyle={{ gap: spacing.sm }}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {job.photo_paths.map((path) => (
            <Image
              className="h-48 w-64 rounded-lg"
              key={path}
              source={{ uri: jobPhotoUrl(path) }}
            />
          ))}
        </ScrollView>
      ) : null}

      <Text className="mb-xs mt-xl text-title font-semibold text-text-primary">Details</Text>
      <Text className="text-body text-text-secondary">
        {job.description ?? 'The poster did not add a description.'}
      </Text>

      <Text className="mb-md mt-xl text-title font-semibold text-text-primary">Posted by</Text>
      {posterQuery.isPending ? (
        <ActivityIndicator color={colors.primary} />
      ) : poster ? (
        <Card padding="sm" variant="filled">
          <View className="flex-row items-center">
            <Avatar
              name={poster.display_name ?? undefined}
              size="lg"
              uri={poster.avatar_url ?? undefined}
            />
            <View className="ml-md flex-1">
              <Text className="text-bodyLarge font-semibold text-text-primary">
                {poster.display_name ?? 'A neighbour'}
              </Text>
              {poster.postal_fsa ? (
                <Text className="mt-px text-footnote text-text-secondary">
                  {poster.postal_fsa} area
                </Text>
              ) : null}
            </View>
          </View>
          {poster.bio ? (
            <Text className="mt-md text-body text-text-secondary">{poster.bio}</Text>
          ) : null}
        </Card>
      ) : (
        <Text className="text-body text-text-muted">
          This poster&rsquo;s profile is unavailable.
        </Text>
      )}

      <View className="mt-md">
        <Text className="text-caption text-text-muted">
          Yoodle shows a neighbourhood, not an address. The exact location is shared only once an
          offer has been accepted.
        </Text>
      </View>

      <View className="mt-xl">
        <Button disabled fullWidth label="Apply (coming soon)" size="lg" />
        <Text className="mt-sm text-center text-caption text-text-muted">
          Applying opens up in the next release.
        </Text>
      </View>
    </ScrollView>
  );
};
