import { Pressable, Text, View } from 'react-native';

export type StarRatingSize = 'sm' | 'md' | 'lg';

export interface StarRatingProps {
  /** 1–5. Use 0 for "nothing chosen yet" in the interactive form. */
  value: number;
  /** Supplied only when the stars are a control. Omit for a read-only display. */
  onChange?: (rating: number) => void;
  size?: StarRatingSize;
  /** Read-only: rounds to the nearest whole star for display. */
  accessibilityLabel?: string;
  testID?: string;
}

const MAX_STARS = 5;

const starSize: Record<StarRatingSize, string> = {
  sm: 'text-footnote',
  md: 'text-bodyLarge',
  lg: 'text-heading',
};

/** Hit area for the interactive form. Tiny glyphs need padding, not bigger text. */
const tapPadding: Record<StarRatingSize, string> = {
  sm: 'px-px py-px',
  md: 'px-xs py-xs',
  lg: 'px-xs py-sm',
};

/**
 * Five stars, either as a display or as a control.
 *
 * ONE COMPONENT, TWO MODES, decided by whether `onChange` is given. A read-only
 * rating and an input for one are the same five glyphs with the same spacing;
 * splitting them into two files would mean two places for the alignment to
 * drift apart.
 *
 * The filled/empty distinction is carried by COLOUR AND GLYPH together (★ vs
 * ☆), not by colour alone — colour alone would fail WCAG 1.4.1 for anyone who
 * cannot separate the amber from the muted grey.
 *
 * Accessibility differs by mode and deliberately so: the display is one label
 * ("Rated 4.2 out of 5"), because five separate star nodes is noise to a screen
 * reader. The control exposes five radio-like buttons, because choosing is
 * exactly what a screen-reader user needs to do.
 */
export const StarRating = ({
  value,
  onChange,
  size = 'md',
  accessibilityLabel,
  testID,
}: StarRatingProps) => {
  const interactive = typeof onChange === 'function';
  const filledThrough = Math.round(value);

  if (!interactive) {
    return (
      <View
        accessibilityLabel={accessibilityLabel ?? `Rated ${value.toFixed(1)} out of ${MAX_STARS}`}
        accessibilityRole="image"
        className="flex-row items-center"
        testID={testID}
      >
        {Array.from({ length: MAX_STARS }, (_, index) => (
          <Text
            className={[
              starSize[size],
              index < filledThrough ? 'text-warning' : 'text-text-muted',
            ].join(' ')}
            key={index}
          >
            {index < filledThrough ? '★' : '☆'}
          </Text>
        ))}
      </View>
    );
  }

  return (
    <View accessibilityRole="radiogroup" className="flex-row items-center" testID={testID}>
      {Array.from({ length: MAX_STARS }, (_, index) => {
        const star = index + 1;
        const filled = star <= filledThrough;

        return (
          <Pressable
            accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: filled }}
            className={['active:opacity-60', tapPadding[size]].join(' ')}
            key={star}
            onPress={() => onChange(star)}
          >
            <Text
              className={[starSize[size], filled ? 'text-warning' : 'text-text-muted'].join(' ')}
            >
              {filled ? '★' : '☆'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};
