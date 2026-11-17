// Back/close + centred title. Shared by Send, Receive and Settings.
import React from 'react';
import { View } from 'react-native';
import { t } from '../i18n';
import { IconBtn } from './IconBtn';
import { Txt } from './Txt';

export function SheetHeader({ title, onClose, onBack }: { title?: string; onClose?: () => void; onBack?: () => void }) {
  return (
    <View className="flex-row items-center justify-between px-5">
      <IconBtn
        name={onBack ? 'arrow_l' : 'close'}
        iconSize={16}
        radius={12}
        label={onBack ? t('common.goBack') : t('common.close')}
        onPress={onBack ?? onClose}
      />
      <Txt className="text-[16px] font-semibold">{title}</Txt>
      <View className="w-9" />
    </View>
  );
}
