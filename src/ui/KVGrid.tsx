import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { KV } from './KV';

/** Two-column key/value grid; odd cells right-align. Swap stats, bridge quote. */
export function KVGrid({ rows, tone }: { rows: readonly (readonly [string, React.ReactNode])[]; tone?: (index: number) => string }) {
  return (
    <View className="flex-row flex-wrap">
      {rows.map(([k, v], i) => (
        <View key={k} className="w-1/2 py-1">
          <KV k={k} v={v} right={i % 2 === 1} tone={tone ? tone(i) : C.text0} />
        </View>
      ))}
    </View>
  );
}
