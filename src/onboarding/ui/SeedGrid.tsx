import React from 'react';
import { C, white } from '../../theme';
import { Txt } from '../../ui';
import { View } from 'react-native';

const MASK = '••••••';

export function SeedGrid({ words, columns = 3, hidden }: { words: string[]; columns?: number; hidden?: boolean }) {
  return (
    <View className="flex-row flex-wrap -m-[3px]">
      {words.map((w, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, padding: 3 }}>
          <View
            className="flex-row items-baseline gap-1.5 px-[7px] py-2 rounded-lg"
            style={{ backgroundColor: white(0.04), borderWidth: 1, borderColor: C.lineSoft }}>
            <Txt mono className="text-[9px] text-text3 min-w-[12px]">
              {i + 1}
            </Txt>
            <Txt
              mono
              className="text-[11.5px] font-medium"
              style={hidden ? { color: C.text3 } : undefined}
              accessible={!hidden}
              accessibilityElementsHidden={hidden}
              importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
              selectable={!hidden}>
              {hidden ? MASK : w}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Editable numbered slot in the import grid. */
