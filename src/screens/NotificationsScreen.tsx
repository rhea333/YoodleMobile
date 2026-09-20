import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card } from '../components';
import type { MainStackParamList } from '../navigation/types';
import { useNotificationsStore, type NotificationItem } from '../state/notifications';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<MainStackParamList, 'Notifications'>;

/**
 * What has arrived since the app was opened.
 *
 * In-memory only, by design — see `state/notifications.ts`. Quitting the app
 * clears it, which is why the empty copy says "since you opened the app" rather
 * than implying a durable history the app does not keep.
 *
 * Opening this screen marks everything seen, which is what clears the badge.
 */
export const NotificationsScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const items = useNotificationsStore((state) => state.items);
  const markAllSeen = useNotificationsStore((state) => state.markAllSeen);

  // On FOCUS, not on mount. React Navigation keeps this screen mounted when you
  // push a Chat on top of it, so a mount-only effect left anything that arrived
  // in the meantime marked "New" and the badge stuck after coming back.
  useFocusEffect(
    useCallback(() => {
      markAllSeen();
    }, [markAllSeen]),
  );

  const renderItem = ({ item }: { item: NotificationItem }) => (
    <Card
      onPress={
        item.kind === 'message'
          ? () =>
              navigation.navigate('Chat', {
                jobId: item.jobId,
                otherUserId: item.otherUserId,
                otherUserName: 'Your neighbour',
              })
          : () => navigation.navigate('Offers')
      }
      subtitle={item.title}
      title={item.preview}
      variant={item.seen ? 'outlined' : 'filled'}
    >
      <View className="flex-row items-center gap-xs">
        {!item.seen ? <Badge label="New" tone="accent" withDot /> : null}
        <Text className="text-caption text-text-muted">
          {new Date(item.createdAt).toLocaleString()}
        </Text>
      </View>
    </Card>
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingHorizontal: spacing.lg }}>
      <FlatList
        contentContainerStyle={{
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing['2xl'],
          gap: spacing.md,
          flexGrow: 1,
        }}
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center">
            <Text className="text-center text-title font-semibold text-text-primary">
              Nothing new
            </Text>
            <Text className="mt-sm text-center text-body text-text-secondary">
              Offers and messages that arrive while you have the app open will show up here.
            </Text>
            <View className="mt-lg">
              <Button
                label="See your offers"
                onPress={() => navigation.navigate('Offers')}
                variant="secondary"
              />
            </View>
          </View>
        }
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};
