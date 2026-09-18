/**
 * Yoodle design tokens — the single source of truth for colour, spacing and type.
 *
 * `tailwind.config.ts` imports this file, so every NativeWind utility class
 * (`bg-surface`, `p-md`, `text-body`) resolves back to the values below.
 * Never hardcode a hex value or a raw pixel margin in a component.
 *
 * The brand is DARK-FIRST: near-black is the primary surface, not a dark-mode
 * alternate. There is therefore ONE palette, not a light/dark pair, and
 * components carry no `dark:` variants. `app.json` pins
 * `userInterfaceStyle: "dark"` so the OS cannot wash the brand out.
 */

/**
 * Raw ramps. Components should prefer the semantic `colors` map below.
 *
 * Values marked BRAND are sampled from the live Yoodle site and must not be
 * changed without a brand decision. Everything else is DERIVED from them to
 * fill roles the brand set does not define (pressed states, subtle fills,
 * muted text), and is chosen to clear WCAG AA.
 */
export const palette = {
  /** Yoodle Moss — the brand green. `500` is the CTA, `300` the gradient's light stop. */
  moss: {
    /** DERIVED — subtle fill behind primary badges and avatar initials. */
    900: '#16251C',
    /** DERIVED — pressed state for the deeper accent. */
    700: '#4E7D5F',
    /** BRAND — accent gradient, dark stop. */
    600: '#5C9270',
    /** BRAND — CTA. */
    500: '#7FBE8E',
    /** DERIVED — pressed state for the CTA. */
    400: '#6BA37F',
    /** BRAND — accent gradient, light stop. */
    300: '#94D0A5',
  },

  /** Warm-neutral near-blacks and sages. The brand's ground and its text. */
  bark: {
    /** DERIVED — sits just below the page ground for sunken areas. */
    1000: '#0A0F0D',
    /** BRAND — page background. */
    950: '#0C1210',
    /** BRAND — card / raised surface. */
    900: '#161D18',
    /** DERIVED — lifted surface: filled buttons, filled cards, skeletons. */
    850: '#1E2721',
    /** BRAND — border. */
    800: '#26302A',
    /** DERIVED — stronger border, for where a hairline is not enough. */
    700: '#3C4A42',
    /** DERIVED — muted text; the dimmest text that still clears 4.5:1. */
    400: '#7A8C82',
    /** BRAND — secondary text. */
    300: '#8FA097',
    /** BRAND — primary text. */
    50: '#F0ECE2',
  },

  /**
   * Status ramps, carried over from the previous palette and re-measured
   * against the new near-black ground rather than re-picked. Each `base` is
   * the label colour and each `subtle` the fill behind it.
   *
   * KNOWN COLLISION: `green.base` is a green, and so is the brand CTA, so a
   * "success" badge reads as brand chrome rather than as a status. Flagged, not
   * resolved — resolving it needs a brand decision, not a contrast fix.
   */
  green: { subtle: '#183A2C', base: '#8FD9B6' },
  amber: { subtle: '#3D2E10', base: '#F0C368' },
  red: { subtle: '#3D1C16', base: '#F08E7C', strong: '#F5B0A3' },
  blue: { subtle: '#16304A', base: '#8CBCE8' },
} as const;

/**
 * Semantic colour roles — the contract every component styles against.
 *
 * Foreground/background pairs are measured to clear WCAG AA (4.5:1 for body
 * text, 3:1 for large text). Three pairs deliberately do not clear 3:1 as
 * *boundaries*; see the note under `surfaceMuted`.
 */
export type ColorRole = keyof typeof colors;
export type ThemeColors = Record<ColorRole, string>;

export const colors = {
  background: palette.bark[950],
  surface: palette.bark[900],
  /**
   * The lifted plane: filled secondary buttons, filled cards, skeletons.
   *
   * At 1.23:1 against `background` this does not clear WCAG 1.4.11's 3:1 for a
   * control boundary — clearing it would need roughly `#4A5A50`, which is no
   * longer a dark-first surface. Controls using this fill are instead
   * identified by their label (13.02:1), which 1.4.11 accepts. Logged in
   * SECURITY.md as a deliberate, measured interpretation rather than an
   * oversight.
   */
  surfaceMuted: palette.bark[850],
  surfaceSunken: palette.bark[1000],
  border: palette.bark[800],
  borderStrong: palette.bark[700],

  textPrimary: palette.bark[50],
  textSecondary: palette.bark[300],
  textMuted: palette.bark[400],
  /** For text on a light brand fill (the CTA, the accent) — never on the ground. */
  textInverse: palette.bark[950],

  primary: palette.moss[500],
  primaryPressed: palette.moss[400],
  /** The CTA is light green, so its label is dark. Do not use `textPrimary` here. */
  primaryForeground: palette.bark[950],
  primarySubtle: palette.moss[900],
  primarySubtleForeground: palette.moss[300],

  /** Solid stand-in for the accent gradient; see `gradients.accent`. */
  accent: palette.moss[600],
  accentPressed: palette.moss[400],
  accentForeground: palette.bark[950],
  accentSubtle: '#14231A',
  accentSubtleForeground: palette.moss[300],

  success: palette.green.base,
  successSubtle: palette.green.subtle,
  warning: palette.amber.base,
  warningSubtle: palette.amber.subtle,
  danger: palette.red.base,
  dangerPressed: palette.red.strong,
  dangerSubtle: palette.red.subtle,
  info: palette.blue.base,
  infoSubtle: palette.blue.subtle,

  focusRing: palette.moss[300],
  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: palette.bark[850],
} as const;

/**
 * The brand accent is a gradient. Stored as stops so the values are captured;
 * nothing renders a real gradient yet — that needs `expo-linear-gradient`,
 * which is intentionally not installed. Use `colors.accent` for solid fills.
 */
export const gradients = {
  accent: { from: palette.moss[600], to: palette.moss[300] },
} as const;

/** Spacing scale in points. Use these, never a raw pixel margin. */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

/** Corner radii in points. */
export const radii = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

/** Font weights as React Native accepts them (string literals, not numbers). */
export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Type scale. Each step pairs a size with a line height so vertical rhythm
 * stays consistent; Tailwind receives them as [fontSize, lineHeight] tuples.
 */
export const typography = {
  caption: { fontSize: 12, lineHeight: 16 },
  footnote: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 22 },
  bodyLarge: { fontSize: 17, lineHeight: 24 },
  title: { fontSize: 20, lineHeight: 27 },
  heading: { fontSize: 24, lineHeight: 31 },
  display: { fontSize: 30, lineHeight: 38 },
} as const;

/**
 * Cross-platform elevation. iOS reads the shadow keys, Android reads `elevation`.
 *
 * Note: on a #0C1210 ground a black shadow is very nearly invisible, so these
 * carry far less weight than they did on the previous light palette. `Card`'s
 * `elevated` variant is affected — see TESTING.md.
 */
export const elevation = {
  none: { shadowOpacity: 0, elevation: 0 },
  sm: {
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radii;
export type TypographyToken = keyof typeof typography;

export const tokens = {
  palette,
  colors,
  gradients,
  spacing,
  radii,
  fontWeights,
  typography,
  elevation,
} as const;
