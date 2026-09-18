import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Badge, Button, Card, TextInput } from '../components';
import { gradients, spacing } from '../theme';

/**
 * Placeholder Home screen. Its only job this phase is to prove the app boots
 * and to let the design system be eyeballed against the real brand palette.
 * Real screens land in later phases.
 *
 * There is no light/dark toggle: the brand is dark-first and single-theme.
 */
export const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing['2xl'] }}
    >
      <View className="mb-xl flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Avatar name="Rhea G" size="lg" />
          <View className="ml-md">
            <Text className="text-heading font-bold text-text-primary">Hey neighbour</Text>
            <Text className="text-footnote text-text-secondary">Design system preview</Text>
          </View>
        </View>
        <Badge label="Dark-first" tone="accent" withDot />
      </View>

      <Text className="mb-md text-title font-semibold text-text-primary">Accent gradient</Text>
      <View className="mb-xl flex-row items-center gap-sm">
        <View className="flex-1 rounded-md p-md" style={{ backgroundColor: gradients.accent.from }}>
          <Text className="text-caption font-semibold text-text-inverse">
            from {gradients.accent.from}
          </Text>
        </View>
        <View className="flex-1 rounded-md p-md" style={{ backgroundColor: gradients.accent.to }}>
          <Text className="text-caption font-semibold text-text-inverse">
            to {gradients.accent.to}
          </Text>
        </View>
      </View>

      <Text className="mb-md text-title font-semibold text-text-primary">Buttons</Text>
      <View className="gap-sm">
        <Button label="Post a job" onPress={() => undefined} />
        <Button label="Browse nearby" onPress={() => undefined} variant="accent" />
        <Button label="Save for later" onPress={() => undefined} variant="secondary" />
        <Button label="View details" onPress={() => undefined} variant="ghost" />
        <Button label="Cancel job" onPress={() => undefined} variant="danger" />
        <View className="flex-row items-center gap-sm">
          <Button label="Small" onPress={() => undefined} size="sm" />
          <Button label="Large" onPress={() => undefined} size="lg" />
        </View>
        <View className="flex-row items-center gap-sm">
          <Button label="Working" loading onPress={() => undefined} />
          <Button disabled label="Disabled" onPress={() => undefined} />
        </View>
      </View>

      <Text className="mb-md mt-xl text-title font-semibold text-text-primary">Cards</Text>
      <View className="gap-md">
        <Card subtitle="Riverdale · 1.2 km away" title="Shovel my driveway">
          <Text className="text-body text-text-secondary">
            Two-car driveway, salt provided. Looking for someone this weekend.
          </Text>
          <View className="mt-md flex-row items-center gap-xs">
            <Badge label="Open" tone="success" withDot />
            <Badge label="$40" tone="primary" />
            <Badge label="Outdoor" tone="neutral" />
          </View>
        </Card>

        <Card
          subtitle="Tap to confirm this card is pressable"
          title="Outlined card"
          variant="outlined"
        >
          <Text className="text-body text-text-secondary">
            Uses the bordered surface instead of a shadow.
          </Text>
        </Card>

        <Card
          onPress={() => undefined}
          subtitle="Filled surface, whole card is one tap target"
          title="Assemble IKEA shelf"
          variant="filled"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Avatar name="Luc Bernard" size="sm" />
              <Text className="ml-sm text-footnote text-text-secondary">Luc B.</Text>
            </View>
            <Badge label="In progress" tone="warning" withDot />
          </View>
        </Card>
      </View>

      <Text className="mb-md mt-xl text-title font-semibold text-text-primary">Inputs</Text>
      <View className="gap-md">
        <TextInput
          helperText="Keep it short and specific."
          label="Job title"
          onChangeText={setNote}
          placeholder="e.g. Mow my lawn"
          value={note}
        />
        <TextInput error="Please enter a postal code." label="Postal code" placeholder="M5V 2T6" />
        <TextInput editable={false} label="Disabled" placeholder="Not editable" />
      </View>

      <Text className="mb-md mt-xl text-title font-semibold text-text-primary">
        Avatars &amp; badges
      </Text>
      <View className="mb-md flex-row items-center gap-sm">
        <Avatar name="Ama Osei" size="sm" />
        <Avatar name="Ama Osei" size="md" />
        <Avatar name="Marie-Claude Tremblay" size="lg" />
        <Avatar name="Sam" size="xl" />
      </View>
      <View className="flex-row flex-wrap gap-xs">
        <Badge label="Neutral" />
        <Badge label="Primary" tone="primary" />
        <Badge label="Accent" tone="accent" />
        <Badge label="Success" tone="success" />
        <Badge label="Warning" tone="warning" />
        <Badge label="Danger" tone="danger" />
        <Badge label="Info" tone="info" />
      </View>
    </ScrollView>
  );
};
