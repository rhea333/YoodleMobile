import type { Config } from 'tailwindcss';

import { colors, fontWeights, palette, radii, spacing, typography } from './src/theme/tokens';

/** `surfaceMuted` -> `surface-muted`, so roles read naturally as utility classes. */
const toKebab = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * One emission per role. The brand is dark-first, so there is no light/dark
 * pair and no `-dark` twin: `bg-surface` IS the brand surface. Components
 * carry no `dark:` variants, and `darkMode` is deliberately left unset so a
 * stray `dark:` class cannot silently introduce a second theme.
 */
const semanticColors = (): Record<string, string> =>
  Object.fromEntries(Object.entries(colors).map(([role, value]) => [toKebab(role), value]));

const fontSizes = (): Record<string, [string, string]> => {
  const out: Record<string, [string, string]> = {};
  for (const [name, step] of Object.entries(typography)) {
    out[name] = [`${step.fontSize}px`, `${step.lineHeight}px`];
  }
  return out;
};

/** Tailwind's spacing/radius maps are string-valued; tokens are numeric points. */
const toPx = (scale: Record<string, number>): Record<string, string> =>
  Object.fromEntries(Object.entries(scale).map(([key, value]) => [key, `${value}px`]));

export default {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Tailwind resolves presets via CJS.
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ...semanticColors(),
        moss: palette.moss,
        bark: palette.bark,
      },
      spacing: toPx(spacing),
      borderRadius: toPx(radii),
      fontSize: fontSizes(),
      fontWeight: fontWeights,
    },
  },
  plugins: [],
} satisfies Config;
