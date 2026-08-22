import React from 'react';
import { Pressable, View } from 'react-native';
import { C, white } from '../theme';
import { Icon } from './icons';
import type { IconName } from './icons';

export function IconBtn({
  name,
  onPress,
  color = C.text1,
  badge,
  label,
}: {
  name: IconName;
  onPress?: () => void;
  color?: string;
  badge?: string;
  /** Icon-only controls have no implicit accessible name in RN. */
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? name}
      className="w-9 h-9 rounded-[10px] items-center justify-center"
      style={{ backgroundColor: white(0.04), borderWidth: 1, borderColor: C.lineSoft }}>
      <Icon name={name} size={18} color={color} />
      {badge && <View className="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full" style={{ backgroundColor: badge }} />}
    </Pressable>
  );
}

/** Tinted rounded square holding an icon. Activity rows, route steps, feature
 *  tiles and settings rows all use this; none of them re-implement it. */
