// Back chevron + segmented progress + `n/total`. Omit `step` for back only.
import React from 'react';
import { View } from 'react-native';
import { t } from '../../i18n';
import { C, white } from '../../theme';
import { IconBtn, Txt } from '../../ui';

export function StepHeader({ onBack, step, total = 4 }: { onBack?: () => void; step?: number; total?: number }) {
  return (
    <View className="flex-row items-center gap-2.5 px-5">
      <IconBtn name="arrow_l" size={32} iconSize={16} stroke={2} onPress={onBack} label={t('common.back')} />
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
