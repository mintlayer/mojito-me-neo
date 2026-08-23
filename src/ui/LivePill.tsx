import React from 'react';
import { View } from 'react-native';
import { C, alpha } from '../theme';
import { Txt } from './Txt';

export function LivePill({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const up = value >= 0;
  const c = up ? C.green : C.red;
  return (
    <View className="flex-row items-center px-1.5 py-0.5 rounded-md self-start" style={{ backgroundColor: alpha(c, 0.12) }}>
      <Txt mono className="text-[11px] font-semibold" style={{ color: c }}>
        {up ? '▲' : '▼'} {Math.abs(value).toFixed(2)}
        {suffix}
      </Txt>
    </View>
  );
}
