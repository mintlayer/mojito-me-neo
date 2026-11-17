import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { Txt } from './Txt';

export function KV({ k, v, tone = C.text0, right }: { k: string; v: React.ReactNode; tone?: string; right?: boolean }) {
  return (
    <View className={right ? 'items-end' : ''}>
      <Txt className="text-[10px] text-text3 tracking-label">{k.toUpperCase()}</Txt>
      <Txt mono className="text-[11px] mt-0.5" style={{ color: tone }}>
        {v}
      </Txt>
    </View>
  );
}

/** Single-line `label ....... value` row: dex footer, send review. */
