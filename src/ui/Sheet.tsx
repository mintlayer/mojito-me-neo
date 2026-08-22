import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, black } from '../theme';
import { Txt } from './Txt';

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    // No statusBarTranslucent — with app.json's edgeToEdgeEnabled on Android 15
    // it swallows every touch inside the modal.
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" style={{ backgroundColor: black(0.55) }} onPress={onClose} />
      <View
        className="px-[22px] pt-3 rounded-t-[24px]"
        style={{
          backgroundColor: C.bg1,
          borderTopWidth: 1,
          borderTopColor: C.lineSoft,
          paddingBottom: Math.max(insets.bottom, 20) + 14,
          maxHeight: '80%',
        }}>
        <View className="w-10 h-1 rounded-full self-center mb-4" style={{ backgroundColor: C.line }} />
        {title && <Txt className="text-[18px] font-bold tracking-tightest mb-3">{title}</Txt>}
        {children}
      </View>
    </Modal>
  );
}

/** Single-select list in a sheet. Currency, appearance, default DEX, chains. */
