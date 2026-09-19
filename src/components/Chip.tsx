import { Pressable, Text, View } from 'react-native';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Optional trailing count, e.g. the number of jobs in a category. */
  count?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A selectable filter pill.
 *
 * Distinct from `Badge`, which is a passive status marker: this one is a
 * control, so it carries a pressed state, a disabled state and the
 * `radio`/`selected` accessibility semantics a filter row needs.
 *
 * Selection is shown by FILL rather than by an outline, matching the reasoning
 * in `Button`: on the near-black ground no hairline in the palette reaches
 * WCAG 1.4.11's 3:1 for a control boundary.
 */
export const Chip = ({
  label,
  selected = false,
  onPress,
  count,
  disabled = false,
  accessibilityLabel,
  testID,
}: ChipProps) => (
  <Pressable
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityRole="radio"
    accessibilityState={{ disabled, selected }}
    className={[
      'flex-row items-center self-start rounded-full px-md py-sm',
      selected ? 'bg-primary active:bg-primary-pressed' : 'bg-surface-muted active:bg-surface',
      disabled ? 'opacity-40' : '',
    ].join(' ')}
    disabled={disabled}
    onPress={onPress}
    testID={testID}
  >
    <Text
      className={[
        'text-footnote font-medium',
        selected ? 'text-primary-foreground' : 'text-text-secondary',
      ].join(' ')}
    >
      {label}
    </Text>
    {count !== undefined ? (
      <View
        className={[
          'ml-xs rounded-full px-xs',
          selected ? 'bg-primary-foreground/20' : 'bg-background/40',
        ].join(' ')}
      >
        <Text
          className={[
            'text-caption font-semibold',
            selected ? 'text-primary-foreground' : 'text-text-muted',
          ].join(' ')}
        >
          {count}
        </Text>
      </View>
    ) : null}
  </Pressable>
);
