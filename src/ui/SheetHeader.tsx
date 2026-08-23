import React from 'react';
import { Pressable, View } from 'react-native';
import { C, white } from '../theme';
import { Icon } from './icons';
import { Txt } from './Txt';

export function SheetHeader({ title, onClose, onBack }: { title?: string; onClose?: () => void; onBack?: () => void }) {
  return (
    <View className="flex-row items-center justify-between px-5">
      <Pressable
        onPress={onBack ?? onClose}
        accessibilityRole="button"
        accessibilityLabel={onBack ? 'Go back' : 'Close'}
        className="w-9 h-9 rounded-xl items-center justify-center"
        style={{ backgroundColor: white(0.04), borderWidth: 1, borderColor: C.lineSoft }}>
        <Icon name={onBack ? 'arrow_l' : 'close'} size={16} color={C.text1} />
      </Pressable>
      <Txt className="text-[16px] font-semibold">{title}</Txt>
      <View className="w-9" />
    </View>
  );
}

/* ── Identity & data viz ────────────────────────────────────── */

/** Gradient tile/circle with an initial. Header, profile card, contacts. */
