import { Text, View } from 'react-native';

import { JOB_CATEGORIES } from '../services';
import { Chip } from './Chip';

export interface CategoryPickerProps {
  value: string | null;
  onChange: (category: string) => void;
  /** Inline error, shown under the row. */
  error?: string;
  label?: string;
}

/**
 * Pick one category from the fixed list.
 *
 * A wrapping row of chips rather than a native picker: there are eight options,
 * they are all short, and a dropdown would hide them behind a tap. Selection
 * state comes from `Chip`, which already carries the right accessibility
 * semantics for a single-choice group.
 */
export const CategoryPicker = ({
  value,
  onChange,
  error,
  label = 'Category',
}: CategoryPickerProps) => (
  <View>
    <Text className="mb-sm text-footnote font-medium text-text-secondary">{label}</Text>
    <View className="flex-row flex-wrap gap-xs">
      {JOB_CATEGORIES.map((category) => (
        <Chip
          key={category}
          label={category}
          onPress={() => onChange(category)}
          selected={value === category}
        />
      ))}
    </View>
    {error ? <Text className="mt-xs text-caption text-danger">{error}</Text> : null}
  </View>
);
