import React from 'react';
import { View } from 'react-native';
import { CHAINS } from '../theme';
import type { ChainName } from '../theme';
import { Txt } from './Txt';
import { tint } from './style';

export function ChainBadge({ chain }: { chain: ChainName }) {
  const c = CHAINS[chain];
  return (
    <View
      className="flex-row items-center gap-1.5 px-1.5 py-0.5 rounded-md"
      style={tint(c)}>
      <View className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: c }} />
      <Txt className="text-[10px] font-semibold tracking-wider" style={{ color: c }}>
        {chain.toUpperCase()}
      </Txt>
    </View>
  );
}
