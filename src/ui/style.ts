import { C, alpha, white } from '../theme';
import type { Tone } from '../theme';
import type { ViewStyle } from 'react-native';

export type Cls = { className?: string; style?: ViewStyle | ViewStyle[] };

/** expo-linear-gradient types `colors` as a 2+ tuple; our palettes are arrays. */

export const gradColors = (c: readonly string[]) => c as unknown as readonly [string, string, ...string[]];

/* ── Typography ──────────────────────────────────────────────
   RN Text does not inherit colour from its parent, so every text node goes
   through Txt and picks up the palette default. */

/** Resolve a fixture's `tone` name to a palette colour. The `Tone` union makes
 *  a misspelled name a compile error instead of invisible. */

export const toneColor = (name: Tone): string => C[name];

/** The same hairline as `Divider`, for places that separate with a border on
 *  the element itself rather than an extra child. */

export const hairlineTop = { borderTopWidth: 1, borderTopColor: C.lineSoft } as const;

/* ── Small surfaces ──────────────────────────────────────────
   Two recipes cover every non-Card panel (icon buttons, keypad keys, chips,
   badges, fee tiers). The intensity parameters exist for the deliberate
   variants; pass them explicitly, never inline the raw alpha numbers. */

/** The raised tile: white-washed fill with the soft hairline. */
export const tile = (fill = 0.04, border: string = C.lineSoft) => ({
  backgroundColor: white(fill),
  borderWidth: 1,
  borderColor: border,
});

/** A colour-tinted surface: translucent fill with a matching border. */
export const tint = (c: string, fill = 0.14, line = 0.25) => ({
  backgroundColor: alpha(c, fill),
  borderWidth: 1,
  borderColor: alpha(c, line),
});

/* ── Screen scaffolding ─────────────────────────────────────── */

/** Title + accent chip + one-line blurb. Swap, Bridge and Card share it. */
