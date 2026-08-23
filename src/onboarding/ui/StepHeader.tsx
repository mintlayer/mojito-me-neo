import React from 'react';
import { C, white } from '../../theme';
import { Icon, Txt } from '../../ui';
import { Pressable, View } from 'react-native';

export function StepHeader({ onBack, step, total = 4 }: { onBack?: () => void; step?: number; total?: number }) {
  return (
    <View className="flex-row items-center gap-2.5 px-5">
      <Pressable
        onPress={onBack}
        className="w-8 h-8 rounded-[10px] items-center justify-center"
        style={{ backgroundColor: white(0.04), borderWidth: 1, borderColor: C.lineSoft }}>
        <Icon name="arrow_l" size={16} color={C.text1} stroke={2} />
      </Pressable>
      {step ? (
        <>
          <View className="flex-1 flex-row gap-1">
            {Array.from({ length: total }, (_, i) => (
              <View key={i} className="flex-1 h-[3px] rounded-full" style={{ backgroundColor: i < step ? C.amber : white(0.07) }} />
            ))}
          </View>
          <Txt mono className="text-[11px] text-text3">
            {step}/{total}
          </Txt>
        </>
      ) : (
        <View className="flex-1" />
      )}
    </View>
  );
}

/** Underlined tertiary action ("Use PIN instead", "Use a custom path"). */
