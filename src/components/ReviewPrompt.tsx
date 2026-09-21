import { Pressable, Text, View } from 'react-native';

import { Button } from './Button';
import { Card } from './Card';

export interface ReviewPromptProps {
  /** Who the review would be about. */
  counterpartyName: string;
  /** Their side of the job, which changes the wording. */
  counterpartyRole: 'poster' | 'worker';
  onLeaveReview: () => void;
  onDismiss: () => void;
  testID?: string;
}

/**
 * "How did it go?" — shown once per completed job, per person.
 *
 * INLINE AND DISMISSIBLE, NOT A MODAL. A modal would be the obvious way to get
 * a review, and it is the wrong one: it interrupts whatever the person opened
 * the screen to do, and the brief is explicit that dismissing must not block
 * navigation. This sits in the page, takes a tap to dismiss, and takes no taps
 * at all to ignore.
 *
 * It renders only when the caller has established there is something to
 * prompt for — job complete, this user was party to it, no review written yet,
 * not previously dismissed. This component decides none of that; it is the last
 * step of that decision, not the decision.
 */
export const ReviewPrompt = ({
  counterpartyName,
  counterpartyRole,
  onLeaveReview,
  onDismiss,
  testID,
}: ReviewPromptProps) => (
  <Card padding="sm" testID={testID} variant="filled">
    <View className="flex-row items-start justify-between">
      <View className="flex-1 pr-md">
        <Text className="text-title font-semibold text-text-primary">How did it go?</Text>
        <Text className="mt-xs text-footnote text-text-secondary">
          {counterpartyRole === 'worker'
            ? `This job is complete. Leave ${counterpartyName} a rating so other neighbours know what to expect.`
            : `This job is complete. Leave ${counterpartyName} a rating so other workers know what to expect.`}
        </Text>
      </View>

      {/*
        A plain × rather than a "No thanks" button: dismissing should be the
        quiet option, and giving it equal visual weight to the action invites
        people to treat them as a real choice.
      */}
      <Pressable
        accessibilityLabel="Dismiss this review prompt"
        accessibilityRole="button"
        className="rounded-full px-sm py-xs active:opacity-60"
        onPress={onDismiss}
      >
        <Text className="text-bodyLarge text-text-muted">×</Text>
      </Pressable>
    </View>

    <View className="mt-md flex-row">
      <Button label="Leave a review" onPress={onLeaveReview} size="sm" />
    </View>
  </Card>
);
