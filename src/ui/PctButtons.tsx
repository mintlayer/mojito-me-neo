import React from 'react';
import { Pressable, View } from 'react-native';
import { tile } from './style';
import { Txt } from './Txt';

export function PctButtons({ onPick, compact }: { onPick: (fraction: number) => void; compact?: boolean }) {
  const opts: [string, number][] = compact
    ? [
        ['½', 0.5],
        ['Max', 1],
      ]
    : [
        ['25%', 0.25],
        ['50%', 0.5],
        ['75%', 0.75],
        ['Max', 1],
      ];
  return (
    <View className="flex-row gap-1.5">
      {opts.map(([l, f]) => (
        <Pressable
          key={l}
          onPress={() => onPick(f)}
          className={`${compact ? 'px-2 py-0.5 rounded' : 'flex-1 py-1.5 rounded-lg'} items-center`}
          style={[tile(), compact && { borderWidth: 0 }]}>
          <Txt className="text-[11px] font-medium text-text1">{l}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

/** Inset `LABEL [value] UNIT` row — the dex order ticket fields. */
