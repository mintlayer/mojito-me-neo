import React from 'react';
import { Pressable, View } from 'react-native';
import { C } from '../theme';
import { Icon } from './icons';
import type { IconName } from './icons';
import { tile } from './style';

/** Rounded-square icon control on the shared tile surface. Header actions,
 *  sheet close/back and the onboarding step header are all this button. */
export function IconBtn({
  name,
  onPress,
  color = C.text1,
  badge,
  label,
  size = 36,
  radius = 10,
  iconSize = 18,
  stroke,
}: {
  name: IconName;
  onPress?: () => void;
  color?: string;
  badge?: string;
  /** Icon-only controls have no implicit accessible name in RN. */
  label?: string;
  /** Edge length in px (default 36, i.e. `w-9 h-9`). */
  size?: number;
  radius?: number;
  iconSize?: number;
  stroke?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? name}
      className="items-center justify-center"
      style={[tile(), { width: size, height: size, borderRadius: radius }]}>
      <Icon name={name} size={iconSize} color={color} stroke={stroke} />
      {badge && <View className="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full" style={{ backgroundColor: badge }} />}
    </Pressable>
  );
}
