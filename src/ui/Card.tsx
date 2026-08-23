import React from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, black, white } from '../theme';
import { gradColors } from './style';
import type { Cls } from './style';

const SURFACES = {
  flat: { bg: white(0.03), border: C.lineSoft },
  inset: { bg: black(0.3), border: C.lineSoft },
  glass: { bg: white(0.035), border: C.lineSoft },
  solid: { bg: white(0.04), border: C.lineSoft },
} as const;

export function Card({
  children,
  variant = 'flat',
  grad,
  accent,
  className = '',
  style,
}: Cls & {
  children?: React.ReactNode;
  variant?: keyof typeof SURFACES;
  /** Render as a gradient panel instead of a flat fill (see G.raised* in theme). */
  grad?: readonly string[];
  /** Override the border colour, e.g. with a chain accent. */
  accent?: string;
}) {
  const s = SURFACES[variant];
  const box = { borderWidth: 1, borderColor: accent ?? s.border } as ViewStyle;
  if (grad) {
    return (
      <LinearGradient
        colors={gradColors(grad)}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={[box, style as ViewStyle]}
        className={`rounded-[20px] overflow-hidden ${className}`}>
        {children}
      </LinearGradient>
    );
  }
  return (
    <View className={`rounded-[20px] ${className}`} style={[box, { backgroundColor: s.bg }, style as ViewStyle]}>
      {children}
    </View>
  );
}
