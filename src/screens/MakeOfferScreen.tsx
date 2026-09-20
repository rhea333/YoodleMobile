import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, TextInput } from '../components';
import { useJobQuery, useMakeOfferMutation, useSession } from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { MAX_OFFER_MESSAGE_LENGTH, formatBudget } from '../services';
import { spacing } from '../theme';
import { parseBudget } from './jobFormValidation';

type Props = NativeStackScreenProps<MainStackParamList, 'MakeOffer'>;

/**
 * Make or amend an offer on a job.
 *
 * `offers_one_per_worker_per_job` means a second submission amends the existing
 * offer rather than creating a rival one, so this screen is both "apply" and
 * "change my bid".
 *
 * NO MONEY MOVES HERE. This writes a row; it does not authorise, hold or charge
 * anything. The copy says so, because "offer accepted" is otherwise easy to
 * read as "payment agreed".
 */
export const MakeOfferScreen = ({ navigation, route }: Props) => {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;

  const jobQuery = useJobQuery(jobId);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  const makeOffer = useMakeOfferMutation({
    onSuccess: () => navigation.replace('Offers'),
  });

  const handleSubmit = () => {
    setAmountError(null);

    const parsed = parseBudget(amount);
    if (parsed === null) {
      setAmountError('Please enter what you would charge.');
      return;
    }
    if (parsed <= 0) {
      setAmountError('Please enter an amount greater than zero.');
      return;
    }
    if (parsed > 100_000) {
      setAmountError('That amount looks too high. Please check it.');
      return;
    }

    if (!userId) {
      return;
    }

    makeOffer.mutate({ jobId, workerId: userId, amount: parsed, message });
  };

  const budget = formatBudget(jobQuery.data?.budget ?? null);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing['2xl'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-heading font-bold text-text-primary">Make an offer</Text>
        <Text className="mb-xl mt-xs text-footnote text-text-secondary">
          {jobQuery.data ? jobQuery.data.title : 'Loading the job…'}
          {budget ? ` · asking ${budget}` : ''}
        </Text>

        <View className="gap-lg">
          <TextInput
            error={amountError ?? undefined}
            helperText="What you would charge, in Canadian dollars."
            keyboardType="decimal-pad"
            label="Your price"
            onChangeText={setAmount}
            placeholder="40"
            value={amount}
          />
          <TextInput
            helperText={`Optional. ${message.length}/${MAX_OFFER_MESSAGE_LENGTH}`}
            label="Message"
            maxLength={MAX_OFFER_MESSAGE_LENGTH}
            multiline
            onChangeText={setMessage}
            placeholder="I live a few streets over and have my own shovel."
            value={message}
          />
        </View>

        <View className="mt-lg">
          <Card padding="sm" variant="filled">
            <Text className="text-caption text-text-muted">
              Sending an offer does not charge anyone. If the poster accepts, you will arrange
              payment between yourselves for now.
            </Text>
          </Card>
        </View>

        {makeOffer.error ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-danger">{makeOffer.error.message}</Text>
            </Card>
          </View>
        ) : null}

        <View className="mt-xl gap-md">
          <Button
            fullWidth
            label="Send offer"
            loading={makeOffer.isPending}
            onPress={handleSubmit}
            size="lg"
          />
          <Button
            disabled={makeOffer.isPending}
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
