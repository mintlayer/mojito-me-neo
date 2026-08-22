import React from 'react';
import { View } from 'react-native';
import { C, CHAINS, alpha } from '../theme';
import { Txt } from './Txt';

export function ChainBadge({ chain }: { chain: string }) {
  const c = CHAINS[chain as keyof typeof CHAINS] ?? C.text2;
  return (
    <View
      className="flex-row items-center gap-1.5 px-1.5 py-0.5 rounded-md"
      style={{ backgroundColor: alpha(c, 0.14), borderWidth: 1, borderColor: alpha(c, 0.25) }}>
      <View className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: c }} />
      <Txt className="text-[10px] font-semibold tracking-wider" style={{ color: c }}>
        {chain.toUpperCase()}
      </Txt>
    </View>
  );
}
