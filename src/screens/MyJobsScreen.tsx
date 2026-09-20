import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card } from '../components';
import { useCancelJobMutation, useMyJobsQuery, useSession, useTheme } from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { formatBudget, jobStatusLabel } from '../services';
import { spacing } from '../theme';
import type { JobRow, JobStatus } from '../types/database';

type Props = NativeStackScreenProps<MainStackParamList, 'MyJobs'>;

const statusTone = (status: JobStatus): 'success' | 'neutral' | 'warning' | 'danger' => {
  switch (status) {
    case 'published':
      return 'success';
    case 'assigned':
      return 'warning';
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
};

/**
 * The poster's own jobs, in every status.
 *
 * Reads through `listMyJobs` rather than `browse_jobs`, because this is the one
 * place drafts and cancelled listings SHOULD be visible — browse exists to hide
 * them.
 */
export const MyJobsScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;

  const myJobs = useMyJobsQuery(userId);

  // Cancelling is destructive and irreversible from the UI, so it asks first.
  // Inline rather than an Alert: the confirmation appears on the row being
  // cancelled, so there is no chance of confirming against the wrong job.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const cancelJob = useCancelJobMutation({ onSuccess: () => setConfirmingId(null) });

  const renderJob = ({ item }: { item: JobRow }) => {
    const budget = formatBudget(item.budget);
    const isConfirming = confirmingId === item.id;
    const isCancelled = item.status === 'cancelled';

    return (
      <Card title={item.title} variant="outlined">
        <View className="flex-row flex-wrap items-center gap-xs">
          <Badge label={jobStatusLabel(item.status)} tone={statusTone(item.status)} withDot />
          <Badge label={item.category} tone="neutral" />
          {budget ? <Badge label={budget} tone="primary" /> : null}
          {item.photo_paths.length > 0 ? (
            <Badge
              label={`${item.photo_paths.length} photo${item.photo_paths.length > 1 ? 's' : ''}`}
              tone="info"
            />
          ) : null}
        </View>

        {isConfirming ? (
          <View className="mt-md">
            <Text className="mb-sm text-footnote text-text-secondary">
              Cancel this job? It stops appearing in Browse. Nothing is deleted, and you will still
              see it here.
            </Text>
            <View className="flex-row gap-sm">
              <Button
                label="Yes, cancel it"
                loading={cancelJob.isPending}
                onPress={() => cancelJob.mutate(item.id)}
                size="sm"
                variant="danger"
              />
              <Button
                label="Keep it"
                onPress={() => setConfirmingId(null)}
                size="sm"
                variant="ghost"
              />
            </View>
          </View>
        ) : (
          <View className="mt-md flex-row gap-sm">
            <Button
              label="View"
              onPress={() => navigation.navigate('JobDetail', { jobId: item.id })}
              size="sm"
              variant="secondary"
            />
            {!isCancelled ? (
              <>
                <Button
                  label="Edit"
                  onPress={() => navigation.navigate('EditJob', { jobId: item.id })}
                  size="sm"
                  variant="secondary"
                />
                <Button
                  label="Cancel"
                  onPress={() => setConfirmingId(item.id)}
                  size="sm"
                  variant="ghost"
                />
              </>
            ) : null}
          </View>
        )}
      </Card>
    );
  };

  if (myJobs.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (myJobs.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-lg">
        <Text className="text-center text-body text-text-secondary">{myJobs.error.message}</Text>
        <View className="mt-lg">
          <Button label="Try again" onPress={() => void myJobs.refetch()} variant="secondary" />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingHorizontal: spacing.lg }}>
      {cancelJob.error ? (
        <View className="mt-md">
          <Card padding="sm" variant="filled">
            <Text className="text-footnote text-danger">{cancelJob.error.message}</Text>
          </Card>
        </View>
      ) : null}

      <FlatList
        contentContainerStyle={{
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing['2xl'],
          gap: spacing.md,
        }}
        data={myJobs.data}
        keyExtractor={(job) => job.id}
        ListEmptyComponent={
          <View className="items-center justify-center py-2xl">
            <Text className="text-center text-title font-semibold text-text-primary">
              You have not posted anything yet
            </Text>
            <Text className="mt-sm text-center text-body text-text-secondary">
              Post a job and neighbours nearby will see it.
            </Text>
            <View className="mt-lg">
              <Button label="Post a job" onPress={() => navigation.navigate('PostJob')} />
            </View>
          </View>
        }
        refreshControl={
          <RefreshControl
            onRefresh={() => void myJobs.refetch()}
            refreshing={myJobs.isRefetching}
            tintColor={colors.primary}
          />
        }
        renderItem={renderJob}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};
