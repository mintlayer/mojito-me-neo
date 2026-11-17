import React from 'react';
import { TextInput, View } from 'react-native';
import { C, black } from '../theme';
import { Txt } from './Txt';

export function Field({
  label,
  value,
  unit,
  onChangeText,
  tone = C.text0,
}: {
  label: string;
  value: string;
  unit: string;
  onChangeText?: (v: string) => void;
  tone?: string;
}) {
  return (
    <View
      className="flex-row items-center gap-2 px-3.5 py-3 rounded-xl"
      style={{ backgroundColor: black(0.3), borderWidth: 1, borderColor: C.lineSoft }}>
      <Txt className="text-[11px] text-text3 tracking-wider w-[50px]">{label.toUpperCase()}</Txt>
      {onChangeText ? (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          accessibilityLabel={label}
          className="flex-1 font-mono text-[16px] text-right p-0"
          style={{ color: tone }}
        />
      ) : (
        <Txt mono className="flex-1 text-[16px] text-right font-medium" style={{ color: tone }}>
          {value}
        </Txt>
      )}
      <Txt className="text-[11px] text-text2 font-medium w-9 text-right">{unit}</Txt>
    </View>
  );
}

/** Token selector button: icon + symbol (+ chain) + chevron. */
