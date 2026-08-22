import React from 'react';
import { View } from 'react-native';
import { C, CHAINS } from '../theme';
import { Txt } from './Txt';

export function ChainGlyph({ chain, size = 26 }: { chain: string; size?: number }) {
  const c = CHAINS[chain as keyof typeof CHAINS] ?? C.text3;
  return (
    <View
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c }}>
      <Txt className="font-bold" style={{ color: C.ink, fontSize: size * 0.42 }}>
        {chain[0]}
      </Txt>
    </View>
  );
}

/* ── Controls ───────────────────────────────────────────────── */
