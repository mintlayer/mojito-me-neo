import React from 'react';
import { Pressable, View } from 'react-native';
import { C } from '../theme';
import type { IconName } from './icons';
import { IconTile } from './IconTile';
import { Txt } from './Txt';

export function ListRow({
  icon,
  iconColor = C.text1,
  label,
  sub,
  trailing,
  children,
  onPress,
  connector,
  divider,
  compact,
}: {
  icon?: IconName;
  iconColor?: string;
  label: React.ReactNode;
  sub?: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  onPress?: () => void;
  /** Vertical line down to the next row (bridge route). */
  connector?: boolean;
  divider?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      className={`flex-row items-center gap-3 px-3.5 ${compact ? 'py-2' : 'py-3'}`}>
      {divider && <View className="absolute left-0 right-0 top-0" style={{ height: 1, backgroundColor: C.lineSoft }} />}
      {icon && (
        <View>
          <IconTile name={icon} color={iconColor} size={compact ? 30 : 32} />
          {connector && <View className="absolute left-[15px] top-[38px] h-6 w-px" style={{ backgroundColor: C.lineSoft }} />}
        </View>
      )}
      <View className="flex-1 min-w-0">
        {typeof label === 'string' ? <Txt className="text-[13px] font-medium">{label}</Txt> : label}
        {typeof sub === 'string' ? <Txt className="text-[11px] text-text2 mt-0.5">{sub}</Txt> : sub}
      </View>
      {children}
      {typeof trailing === 'string' ? <Txt className="text-[14px] text-text3">{trailing}</Txt> : trailing}
    </Pressable>
  );
}

/** Label + grouped card. Settings sections, Bridge route, Card tiers. */
