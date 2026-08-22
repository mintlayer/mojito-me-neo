import React from 'react';
import { TextInput, View } from 'react-native';
import { TokenPill } from './TokenPill';

export function AmountRow({
  symbol,
  chain,
  value,
  onChangeText,
  onPickToken,
}: {
  symbol: string;
  chain?: string;
  value: string;
  onChangeText?: (v: string) => void;
  /** Opens the asset picker. Without it the pill's chevron is decorative. */
  onPickToken?: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3">
      <TokenPill symbol={symbol} chain={chain} onPress={onPickToken} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!!onChangeText}
        keyboardType="decimal-pad"
        className="flex-1 font-mono text-[26px] font-semibold text-right text-text0 p-0"
      />
    </View>
  );
}

/**
 * Icon tile + title + subtitle + trailing. Settings rows, bridge route steps,
 * card feature tiles and the receive CTA are all this component.
 */
