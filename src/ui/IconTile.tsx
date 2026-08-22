import React from 'react';
import { View } from 'react-native';
import { alpha } from '../theme';
import { Icon } from './icons';
import type { IconName } from './icons';

export function IconTile({
  name,
  color,
  size = 32,
  radius = 9,
  iconSize,
}: {
  name: IconName;
  color: string;
  size?: number;
  radius?: number;
  iconSize?: number;
}) {
  return (
    <View
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: alpha(color, 0.14) }}>
      <Icon name={name} size={iconSize ?? Math.round(size * 0.46)} color={color} />
    </View>
  );
}
