import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card } from '../components';
import {
  usePayoutStatusQuery,
  useSession,
  useStartPayoutOnboardingMutation,
  useTheme,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<MainStackParamList, 'PayoutSetup'>;

/**
 * "Set up payouts" — Stripe Connect Express onboarding.
 *
 * The onboarding form is HOSTED BY STRIPE and opened in a browser. That is the
 * whole design, not a shortcut: it collects legal name, date of birth, address
 * and bank details, and none of it touches Yoodle. Building this form in-app
 * would make us the custodian of exactly the data we least want to hold.
 *
 * Status is read back from the profile, which only an Edge Function can write.
 * A user cannot mark themselves payout-ready, and the release path re-checks
 * with Stripe before paying anyone regardless.
 */
export const PayoutSetupScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;

  const payoutStatus = usePayoutStatusQuery(userId);

  const startOnboarding = useStartPayoutOnboardingMutation({
    onSuccess: async (url) => {
      // openAuthSessionAsync, not openBrowserAsync: it returns control when the
      // `yoodle://payouts` return URL fires, so we can refresh status straight
      // away instead of leaving the user on a dead browser tab.
      await WebBrowser.openAuthSessionAsync(url, 'yoodle://payouts');
      void payoutStatus.refetch();
    },
  });

  const status = payoutStatus.data;
  const ready = status?.payoutsEnabled === true;
  const started = status?.detailsSubmitted === true;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: insets.bottom + spacing['2xl'],
      }}
    >
      <Text className="text-heading font-bold text-text-primary">Get paid for jobs</Text>
      <Text className="mb-xl mt-xs text-footnote text-text-secondary">
        Before a neighbour can pay you, Stripe needs to verify who you are and where to send the
        money.
      </Text>

      {payoutStatus.isPending ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : (
        <>
          <Card padding="md" variant="outlined">
            <View className="flex-row items-center justify-between">
              <Text className="text-title font-semibold text-text-primary">Payout status</Text>
              <Badge
                label={ready ? 'Ready' : started ? 'In review' : 'Not set up'}
                tone={ready ? 'success' : started ? 'warning' : 'neutral'}
                withDot
              />
            </View>
            <Text className="mt-md text-body text-text-secondary">
              {ready
                ? 'You can receive payments. When a poster marks your job complete, the money is sent to your account.'
                : started
                  ? 'Stripe has your details and is reviewing them. This usually takes a few minutes, occasionally longer.'
                  : 'You have not set up payouts yet. You can still bid on jobs, but a poster cannot release payment to you.'}
            </Text>
          </Card>

          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-caption text-text-muted">
                Stripe collects your details on their own secure page. Yoodle never sees your bank
                details, and never sees a card number at any point.
              </Text>
            </Card>
          </View>

          {payoutStatus.isError || startOnboarding.error ? (
            <View className="mt-lg">
              <Card padding="sm" variant="filled">
                <Text className="text-footnote text-danger">
                  {startOnboarding.error?.message ?? payoutStatus.error?.message}
                </Text>
              </Card>
            </View>
          ) : null}

          <View className="mt-xl gap-md">
            <Button
              fullWidth
              label={
                ready ? 'Update payout details' : started ? 'Continue setup' : 'Set up payouts'
              }
              loading={startOnboarding.isPending}
              onPress={() => startOnboarding.mutate()}
              size="lg"
            />
            <Button
              fullWidth
              label="Refresh status"
              onPress={() => void payoutStatus.refetch()}
              variant="secondary"
            />
            <Button fullWidth label="Back" onPress={() => navigation.goBack()} variant="ghost" />
          </View>
        </>
      )}
    </ScrollView>
  );
};
