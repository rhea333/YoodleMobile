import { Text, View } from 'react-native';

export type BadgeTone =
  'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Leading status dot — useful for job states like "Open" or "In progress". */
  withDot?: boolean;
  testID?: string;
}

const background: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted',
  primary: 'bg-primary-subtle',
  accent: 'bg-accent-subtle',
  success: 'bg-success-subtle',
  warning: 'bg-warning-subtle',
  danger: 'bg-danger-subtle',
  info: 'bg-info-subtle',
};

const foreground: Record<BadgeTone, string> = {
  neutral: 'text-text-secondary',
  primary: 'text-primary-subtle-foreground',
  accent: 'text-accent-subtle-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

const dot: Record<BadgeTone, string> = {
  neutral: 'bg-text-muted',
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

const sizing: Record<BadgeSize, string> = {
  sm: 'px-sm py-px',
  md: 'px-md py-xs',
};

export const Badge = ({
  label,
  tone = 'neutral',
  size = 'sm',
  withDot = false,
  testID,
}: BadgeProps) => (
  <View
    className={[
      'flex-row items-center self-start rounded-full',
      background[tone],
      sizing[size],
    ].join(' ')}
    testID={testID}
  >
    {withDot ? <View className={`mr-xs h-2 w-2 rounded-full ${dot[tone]}`} /> : null}
    <Text
      className={[
        'font-medium',
        size === 'sm' ? 'text-caption' : 'text-footnote',
        foreground[tone],
      ].join(' ')}
    >
      {label}
    </Text>
  </View>
);
