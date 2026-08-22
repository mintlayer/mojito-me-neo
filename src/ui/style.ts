import { C } from '../theme';
import type { ViewStyle } from 'react-native';

export type Cls = { className?: string; style?: ViewStyle | ViewStyle[] };

/** expo-linear-gradient types `colors` as a 2+ tuple; our palettes are arrays. */

export const gradColors = (c: readonly string[]) => c as unknown as readonly [string, string, ...string[]];

/* ── Typography ──────────────────────────────────────────────
   RN Text does not inherit colour from its parent, so every text node goes
   through Txt and picks up the palette default. */

export const toneColor = (name: string): string => (C as Record<string, string>)[name] ?? C.text2;

/** The same hairline as `Divider`, for places that separate with a border on
 *  the element itself rather than an extra child. */

export const hairlineTop = { borderTopWidth: 1, borderTopColor: C.lineSoft } as const;

/* ── Screen scaffolding ─────────────────────────────────────── */

/** Title + accent chip + one-line blurb. Swap, Bridge and Card share it. */
