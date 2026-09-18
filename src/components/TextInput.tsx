import { useState } from 'react';
import {
  TextInput as RNTextInput,
  type TextInputProps as RNTextInputProps,
  Text,
  View,
} from 'react-native';

import { useTheme } from '../hooks';

export interface TextInputProps extends Pick<
  RNTextInputProps,
  | 'autoCapitalize'
  | 'autoComplete'
  | 'autoCorrect'
  | 'autoFocus'
  | 'editable'
  | 'keyboardType'
  | 'maxLength'
  | 'multiline'
  | 'onBlur'
  | 'onFocus'
  | 'onSubmitEditing'
  | 'placeholder'
  | 'returnKeyType'
  | 'secureTextEntry'
  | 'testID'
  | 'value'
> {
  label?: string;
  /** Shown under the field; replaced by `error` when one is present. */
  helperText?: string;
  error?: string;
  onChangeText?: (value: string) => void;
}

export const TextInput = ({
  label,
  helperText,
  error,
  editable = true,
  multiline = false,
  onBlur,
  onFocus,
  ...rest
}: TextInputProps) => {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderTone = error ? 'border-danger' : focused ? 'border-focus-ring' : 'border-border';

  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-xs text-footnote font-medium text-text-secondary">{label}</Text>
      ) : null}

      <RNTextInput
        accessibilityLabel={label}
        className={[
          'rounded-md border px-md py-md text-body',
          'bg-surface',
          'text-text-primary',
          borderTone,
          multiline ? 'min-h-24' : '',
          editable ? '' : 'opacity-50',
        ].join(' ')}
        editable={editable}
        multiline={multiline}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={colors.textMuted}
        textAlignVertical={multiline ? 'top' : 'center'}
        {...rest}
      />

      {error ? (
        <Text className="mt-xs text-caption text-danger">{error}</Text>
      ) : helperText ? (
        <Text className="mt-xs text-caption text-text-muted">{helperText}</Text>
      ) : null}
    </View>
  );
};
