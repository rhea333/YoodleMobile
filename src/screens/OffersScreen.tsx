import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card } from '../components';
import {
  useMyOffersQuery,
  useOfferActionMutation,
  useOfferContextQuery,
  useOffersOnMyJobsQuery,
  useSession,
  useTheme,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { formatBudget, offerStatusLabel } from '../services';
import { spacing } from '../theme';
import type { OfferRow, OfferStatus } from '../types/database';

type Props = NativeStackScreenProps<MainStackParamList, 'Offers'>;

const statusTone = (status: OfferStatus): 'success' | 'neutral' | 'warning' | 'danger' => {
  switch (status) {
    case 'accepted':
      return 'success';
    case 'pending':
      return 'warning';
    case 'declined':
      return 'danger';
    default:
      return 'neutral';
  }
};

/**
 * Offers, both directions.
 *
 * The brief asked for a poster's view. It also asked for a chat between poster
 * and worker — and a worker has no other way into that conversation, so this
 * screen carries both sides: offers received on your jobs, and offers you have
 * made. The accept/decline controls appear only on the first.
 *
 * Which list an offer can appear in is not decided here. `offers_select_own`
 * and `offers_select_as_poster` mean a worker is only ever shown their own bid,
 * never a rival's on the same job.
 */
export const OffersScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;

  const received = useOffersOnMyJobsQuery(userId);
  const sent = useMyOffersQuery(userId);

  const allOffers = [...(received.data ?? []), ...(sent.data ?? [])];
  const context = useOfferContextQuery(
    allOffers.map((offer) => offer.job_id),
    allOffers.map((offer) => offer.worker_id),
  );

  const [pendingId, setPendingId] = useState<string | null>(null);
  const offerAction = useOfferActionMutation({ onSuccess: () => setPendingId(null) });

  const loading = received.isPending || sent.isPending;
  const error = received.error ?? sent.error ?? offerAction.error;

  const jobTitle = (jobId: string) => context.data?.jobsById[jobId]?.title ?? 'A job';
  const workerName = (workerId: string) =>
    context.data?.profilesById[workerId]?.display_name ?? 'A neighbour';

  const renderReceived = (offer: OfferRow) => {
    const busy = offerAction.isPending && pendingId === offer.id;

    return (
      <Card
        key={offer.id}
        subtitle={jobTitle(offer.job_id)}
        title={workerName(offer.worker_id)}
        variant="outlined"
      >
        <View className="flex-row flex-wrap items-center gap-xs">
          <Badge label={offerStatusLabel(offer.status)} tone={statusTone(offer.status)} withDot />
          <Badge label={formatBudget(offer.amount) ?? '—'} tone="primary" />
        </View>

        {offer.message ? (
          <Text className="mt-md text-body text-text-secondary">{offer.message}</Text>
        ) : null}

        <View className="mt-md flex-row flex-wrap gap-sm">
          <Button
            label="Message"
            onPress={() =>
              navigation.navigate('Chat', {
                jobId: offer.job_id,
                otherUserId: offer.worker_id,
                otherUserName: workerName(offer.worker_id),
              })
            }
            size="sm"
            variant="secondary"
          />
          {offer.status === 'pending' ? (
            <>
              <Button
                label="Accept"
                loading={busy}
                onPress={() => {
                  setPendingId(offer.id);
                  offerAction.mutate({ offerId: offer.id, action: 'accept' });
                }}
                size="sm"
              />
              <Button
                label="Decline"
                onPress={() => {
                  setPendingId(offer.id);
                  offerAction.mutate({ offerId: offer.id, action: 'decline' });
                }}
                size="sm"
                variant="ghost"
              />
            </>
          ) : null}
        </View>
      </Card>
    );
  };

  const renderSent = (offer: OfferRow) => {
    const job = context.data?.jobsById[offer.job_id];
    const posterId = job?.poster_id;

    return (
      <Card key={offer.id} subtitle="Your offer" title={jobTitle(offer.job_id)} variant="outlined">
        <View className="flex-row flex-wrap items-center gap-xs">
          <Badge label={offerStatusLabel(offer.status)} tone={statusTone(offer.status)} withDot />
          <Badge label={formatBudget(offer.amount) ?? '—'} tone="primary" />
        </View>

        {offer.message ? (
          <Text className="mt-md text-body text-text-secondary">{offer.message}</Text>
        ) : null}

        <View className="mt-md flex-row flex-wrap gap-sm">
          {posterId ? (
            <Button
              label="Message"
              onPress={() =>
                navigation.navigate('Chat', {
                  jobId: offer.job_id,
                  otherUserId: posterId,
                  otherUserName: 'The poster',
                })
              }
              size="sm"
              variant="secondary"
            />
          ) : null}
          {offer.status === 'pending' ? (
            <Button
              label="Withdraw"
              onPress={() => {
                setPendingId(offer.id);
                offerAction.mutate({ offerId: offer.id, action: 'withdraw' });
              }}
              size="sm"
              variant="ghost"
            />
          ) : null}
        </View>
      </Card>
    );
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: insets.bottom + spacing['2xl'],
      }}
      refreshControl={
        <RefreshControl
          onRefresh={() => {
            void received.refetch();
            void sent.refetch();
          }}
          refreshing={received.isRefetching || sent.isRefetching}
          tintColor={colors.primary}
        />
      }
    >
      {error ? (
        <View className="mb-lg">
          <Card padding="sm" variant="filled">
            <Text className="text-footnote text-danger">{error.message}</Text>
          </Card>
        </View>
      ) : null}

      <Text className="mb-md text-title font-semibold text-text-primary">Offers on your jobs</Text>
      {received.data && received.data.length > 0 ? (
        <View className="gap-md">{received.data.map(renderReceived)}</View>
      ) : (
        <Text className="text-body text-text-secondary">Nobody has offered on your jobs yet.</Text>
      )}

      <Text className="mb-md mt-2xl text-title font-semibold text-text-primary">Your offers</Text>
      {sent.data && sent.data.length > 0 ? (
        <View className="gap-md">{sent.data.map(renderSent)}</View>
      ) : (
        <Text className="text-body text-text-secondary">
          You have not offered on anything yet. Browse jobs nearby to get started.
        </Text>
      )}
    </ScrollView>
  );
};
