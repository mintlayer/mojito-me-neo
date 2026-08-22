import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { C, TOKENS } from '../theme';
import { Txt } from './Txt';

export function TokenIcon({ symbol, size = 36 }: { symbol: string; size?: number }) {
  const t = TOKENS[symbol as keyof typeof TOKENS] ?? { from: C.text2, to: C.text3, glyph: symbol[0] };
  return (
    <LinearGradient
      colors={[t.from, t.to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Txt className="font-bold" style={{ color: C.ink, fontSize: size * 0.42 }}>
        {t.glyph}
      </Txt>
    </LinearGradient>
  );
}
