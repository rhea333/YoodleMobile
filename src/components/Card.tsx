import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export type CardVariant = 'elevated' | 'outlined' | 'filled';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  /** Supplied only when the whole card should act as one tap target. */
  onPress?: () => void;
  variant?: CardVariant;
  padding?: CardPadding;
  testID?: string;
}

/**
 * NOTE: on the #0C1210 brand ground `surface` sits only 1.10:1 above
 * `background`, and a black shadow is near-invisible, so `elevated` reads
 * almost flat. Left as-is deliberately — raising `surface` or adding a border
 * to `elevated` is a brand decision, not a contrast fix. See TESTING.md.
 */
const surface: Record<CardVariant, string> = {
  elevated: 'bg-surface shadow-md shadow-bark-1000/40',
  outlined: 'bg-surface border border-border',
  filled: 'bg-surface-muted',
};

const padded: Record<CardPadding, string> = {
  none: '',
  sm: 'p-md',
  md: 'p-lg',
  lg: 'p-xl',
};

export const Card = ({
  children,
  title,
  subtitle,
  onPress,
  variant = 'elevated',
  padding = 'md',
  testID,
}: CardProps) => {
  const body = (
    <>
      {title ? <Text className="text-title font-semibold text-text-primary">{title}</Text> : null}
      {subtitle ? (
        <Text className="mt-xs text-footnote text-text-secondary">{subtitle}</Text>
      ) : null}
      {children ? <View className={title || subtitle ? 'mt-md' : ''}>{children}</View> : null}
    </>
  );

  const className = ['rounded-lg overflow-hidden', surface[variant], padded[padding]].join(' ');

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        className={`${className} active:opacity-80`}
        onPress={onPress}
        testID={testID}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View className={className} testID={testID}>
      {body}
    </View>
  );
};
