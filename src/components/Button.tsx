import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTheme } from '../hooks';
import type { ColorRole } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * `secondary` is a FILLED variant, not an outlined one. On the near-black brand
 * ground no hairline in the palette reaches WCAG 1.4.11's 3:1 for a control
 * boundary (`border` measures 1.26:1 on `surface`), so the control is defined
 * by its fill and its 13.02:1 label instead of by an outline. `border` is
 * reserved for decorative dividers and card edges.
 */
const container: Record<ButtonVariant, string> = {
  primary: 'bg-primary active:bg-primary-pressed',
  secondary: 'bg-surface-muted active:bg-surface',
  accent: 'bg-accent active:bg-accent-pressed',
  ghost: 'bg-transparent active:bg-primary-subtle',
  danger: 'bg-danger active:bg-danger-pressed',
};

/** The brand fills are light green, so their labels are dark, not `textPrimary`. */
const labelTone: Record<ButtonVariant, string> = {
  primary: 'text-primary-foreground',
  secondary: 'text-text-primary',
  accent: 'text-accent-foreground',
  ghost: 'text-primary',
  danger: 'text-text-inverse',
};

/** Which token the spinner borrows, so it never hardcodes a colour. */
const spinnerRole: Record<ButtonVariant, ColorRole> = {
  primary: 'primaryForeground',
  secondary: 'textPrimary',
  accent: 'accentForeground',
  ghost: 'primary',
  danger: 'textInverse',
};

const sizing: Record<ButtonSize, string> = {
  sm: 'px-md py-sm rounded-sm',
  md: 'px-lg py-md rounded-md',
  lg: 'px-xl py-md rounded-lg',
};

const labelSize: Record<ButtonSize, string> = {
  sm: 'text-footnote',
  md: 'text-body',
  lg: 'text-bodyLarge',
};

export const Button = ({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityLabel,
  testID,
}: ButtonProps) => {
  const { colors } = useTheme();
  const isInert = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInert, busy: loading }}
      className={[
        'flex-row items-center justify-center',
        container[variant],
        sizing[size],
        fullWidth ? 'w-full' : 'self-start',
        isInert ? 'opacity-50' : '',
      ].join(' ')}
      disabled={isInert}
      onPress={onPress}
      testID={testID}
    >
      {loading ? (
        <View className="mr-sm">
          <ActivityIndicator color={colors[spinnerRole[variant]]} size="small" />
        </View>
      ) : null}
      <Text className={['font-semibold', labelSize[size], labelTone[variant]].join(' ')}>
        {label}
      </Text>
    </Pressable>
  );
};
