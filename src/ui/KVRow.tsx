import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { Txt } from './Txt';

export function KVRow({ k, v, tone = C.text2 }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <View className="flex-row justify-between items-center">
      <Txt className="text-[12px] text-text2">{k}</Txt>
      {typeof v === 'string' || typeof v === 'number' ? (
        <Txt mono className="text-[12px]" style={{ color: tone }}>
          {v}
        </Txt>
      ) : (
        v
      )}
    </View>
  );
}

/* ── Surfaces ────────────────────────────────────────────────
   Four recipes cover every panel in the design. Nothing else declares its own
   background + border pair. */
