import React from 'react';
import { Pressable, View } from 'react-native';
import { C, white } from '../theme';
import { Icon } from './icons';
import { TokenIcon } from './TokenIcon';
import { Txt } from './Txt';

export function TokenPill({ symbol, chain, onPress }: { symbol: string; chain?: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 pl-2 pr-3 py-2 rounded-full"
      style={{ backgroundColor: white(0.05), borderWidth: 1, borderColor: C.lineSoft }}>
      <TokenIcon symbol={symbol} size={28} />
      <View>
        <Txt className="text-[13px] font-semibold">{symbol}</Txt>
        {chain && <Txt className="text-[9px] text-text3 tracking-wider">{chain.toUpperCase()}</Txt>}
      </View>
      <Icon name="chevron_r" size={14} color={C.text2} />
    </Pressable>
  );
}

/** Token pill + large right-aligned mono amount. Swap panels and Bridge share it. */
