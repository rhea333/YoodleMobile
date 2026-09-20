import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, TextInput } from '../components';
import {
  useSendMessageMutation,
  useSession,
  useTheme,
  useThreadQuery,
  useThreadRealtime,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { MAX_MESSAGE_LENGTH } from '../services';
import { spacing } from '../theme';
import type { MessageRow } from '../types/database';

type Props = NativeStackScreenProps<MainStackParamList, 'Chat'>;

const timeOf = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/**
 * A live conversation about one job.
 *
 * Realtime, not polling: `useThreadRealtime` subscribes for as long as the
 * screen is mounted and pushes arriving rows into the query cache. The
 * subscription is INSERT-only — messages are immutable (no UPDATE policy, and
 * the privilege is revoked), and DELETE events deliberately go unhandled
 * because Realtime does not apply RLS to them. See `services/messages.ts`.
 *
 * Message bodies are sanitised on the way IN, so what is rendered here is
 * already free of the invisible and direction-flipping characters that would
 * otherwise let a message read differently than it was stored.
 */
export const ChatScreen = ({ route }: Props) => {
  const { jobId, otherUserId, otherUserName } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;

  const thread = useThreadQuery(jobId, userId, otherUserId);
  useThreadRealtime(jobId, userId, otherUserId);

  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<MessageRow>>(null);

  const sendMessage = useSendMessageMutation(jobId, userId, otherUserId, {
    onSuccess: () => setDraft(''),
  });

  const messages = thread.data ?? [];

  // Follow the conversation as it grows, including messages that arrive from
  // the other side rather than from this user typing.
  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  const renderMessage = ({ item }: { item: MessageRow }) => {
    const mine = item.sender_id === userId;

    return (
      <View className={mine ? 'items-end' : 'items-start'}>
        <View
          className={[
            'max-w-[80%] rounded-lg px-md py-sm',
            mine ? 'bg-primary' : 'bg-surface-muted',
          ].join(' ')}
        >
          <Text
            className={mine ? 'text-body text-primary-foreground' : 'text-body text-text-primary'}
          >
            {item.body}
          </Text>
        </View>
        <Text className="mt-px text-caption text-text-muted">{timeOf(item.created_at)}</Text>
      </View>
    );
  };

  if (thread.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
      keyboardVerticalOffset={insets.top + spacing['2xl']}
    >
      {thread.isError ? (
        <View style={{ padding: spacing.lg }}>
          <Card padding="sm" variant="filled">
            <Text className="text-footnote text-danger">{thread.error.message}</Text>
          </Card>
        </View>
      ) : null}

      <FlatList
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          flexGrow: 1,
          justifyContent: messages.length === 0 ? 'center' : 'flex-end',
        }}
        data={messages}
        keyExtractor={(message) => message.id}
        ListEmptyComponent={
          <View className="items-center">
            <Text className="text-center text-body text-text-secondary">
              No messages yet. Say hello to {otherUserName}.
            </Text>
          </View>
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ref={listRef}
        renderItem={renderMessage}
        showsVerticalScrollIndicator={false}
      />

      <View
        className="border-t border-border bg-background"
        style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md }}
      >
        {sendMessage.error ? (
          <Text className="mb-sm text-caption text-danger">{sendMessage.error.message}</Text>
        ) : null}
        <View className="flex-row items-end gap-sm">
          <View className="flex-1">
            <TextInput
              maxLength={MAX_MESSAGE_LENGTH}
              multiline
              onChangeText={setDraft}
              placeholder={`Message ${otherUserName}`}
              value={draft}
            />
          </View>
          <Button
            disabled={draft.trim().length === 0}
            label="Send"
            loading={sendMessage.isPending}
            onPress={() => sendMessage.mutate(draft)}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};
