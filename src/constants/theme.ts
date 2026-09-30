/**
 * Geo Threads design tokens — the "Indigo Lake" palette with the Mincho & Gothic
 * type pairing. Aizome indigo and glacial-lake teal, with ginkgo gold as the pop.
 *
 * Components read colours through `useTheme()` and never inline a hex value: a
 * literal only looks right in one of the two themes. The full reference, with
 * usage rules per token, is the Geo Threads design system (see
 * `.claude/skills/geo-threads-ui/SKILL.md`).
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    /** Screen ground. Kasumi 霞, a mist-tinted off-white. */
    background: '#F3F5F8',
    /** Cards, rows, grouped panels. */
    backgroundElement: '#FFFFFF',
    /** Inputs, chips, pressed rows, separators. */
    backgroundSelected: '#E8ECF3',
    border: '#DDE2EB',

    /** Kon 紺, a navy ink. */
    text: '#131A28',
    textSecondary: '#5A6376',

    /** Ai 藍. Filled buttons, your own message bubbles, the selected tab. */
    primary: '#23407A',
    onPrimary: '#FFFFFF',
    /** Indigo for text-only interactive elements: links, text buttons. */
    tint: '#2D57A8',

    /**
     * Ichō 銀杏 ginkgo gold. Fences and anything that should pop, as a FILL:
     * on the light ground it is only 2.1:1, so small marks and text use
     * `accentText` instead.
     */
    accent: '#E0A11F',
    onAccent: '#2A1D00',
    /** Translucent accent for a fence's interior on a map. */
    accentFill: 'rgba(224,161,31,0.22)',
    accentSoft: '#FCEFCD',
    /** Gold dark enough to read as text on the light ground. */
    accentText: '#8A5A00',

    /** Glacier teal. Place chips and secondary emphasis. */
    secondary: '#17716B',
    secondarySoft: '#D7F0EE',

    danger: '#B83A36',
    onDanger: '#FFFFFF',

    /** Dims content behind a sheet. */
    scrim: 'rgba(8,12,20,0.45)',
  },
  dark: {
    background: '#0C111C',
    backgroundElement: '#151C2B',
    backgroundSelected: '#1F2839',
    border: '#232C3D',

    text: '#EBEFF6',
    textSecondary: '#9AA5BA',

    primary: '#3D63B8',
    onPrimary: '#FFFFFF',
    tint: '#8FAAEE',

    accent: '#FFC44D',
    onAccent: '#2A1D00',
    accentFill: 'rgba(255,196,77,0.18)',
    accentSoft: '#3A2E12',
    accentText: '#FFC44D',

    secondary: '#6FD6CE',
    secondarySoft: '#133533',

    danger: '#FF7B72',
    onDanger: '#2A0806',

    scrim: 'rgba(0,0,0,0.6)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type ThemeColors = { [K in ThemeColor]: string };

/**
 * Colours that do not change with the theme: the brand mark and the dark labels
 * drawn over map imagery, which is the same in both themes.
 */
export const Brand = {
  indigo: '#23407A',
  gold: '#F2B230',
  night: '#0C111C',
  /** Label chip over a map. */
  mapLabel: 'rgba(12,17,28,0.72)',
  onMapLabel: '#FFFFFF',
} as const;

/**
 * Font family names. Each weight is its own family because they are loaded at
 * runtime with `useFonts` (one family per file), so set `fontFamily` and leave
 * `fontWeight` unset — pairing the two makes Android and iOS synthesise a
 * faux-bold on top of an already bold face.
 */
export const Fonts = {
  /** Zen Old Mincho 700. Names and section titles only. */
  display: 'ZenOldMincho_700Bold',
  body: 'ZenKakuGothicNew_400Regular',
  bodyMedium: 'ZenKakuGothicNew_500Medium',
  bodyBold: 'ZenKakuGothicNew_700Bold',
  mono: Platform.select({ ios: 'ui-monospace', web: 'var(--font-mono)', default: 'monospace' }),
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  /** Chips and small controls. */
  small: 8,
  /** Inputs and buttons. */
  medium: 14,
  /** Cards and the map hero. */
  large: 20,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
