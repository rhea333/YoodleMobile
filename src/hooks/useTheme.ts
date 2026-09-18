import { colors, type ThemeColors } from '../theme/tokens';

export interface Theme {
  /** Resolved token values, for props that cannot take a className (e.g. tintColor). */
  colors: ThemeColors;
}

/**
 * Styling should normally go through NativeWind classes (`bg-surface`). Use
 * this hook only where React Native demands a literal colour prop, such as
 * `placeholderTextColor` or `ActivityIndicator`'s `color`.
 *
 * Yoodle is dark-first and single-theme, so there is no colour scheme to read
 * and nothing to toggle. This stays a hook rather than a bare import so that
 * if a second theme is ever introduced, every call site already goes through
 * one place.
 */
export const useTheme = (): Theme => ({ colors });
