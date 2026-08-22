import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, alpha, white } from '../theme';

export function ProgressBar({ pct, color = C.amber, height = 4 }: { pct: number; color?: string; height?: number }) {
  return (
    <View className="rounded-full overflow-hidden" style={{ height, backgroundColor: white(0.06) }}>
      <LinearGradient
        colors={[alpha(color, 0.7), color]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', borderRadius: 999 }}
      />
    </View>
  );
}

/* ── Sheets ─────────────────────────────────────────────────
   Lives here rather than in src/onboarding because pickers across the wallet
   use it too. */
