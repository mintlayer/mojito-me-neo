import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Txt } from './Txt';
import { tint } from './style';

export function Callout({
  children,
  tone = C.amber,
  icon,
  glyph,
  action,
  className = '',
  accessibilityRole,
}: {
  children: React.ReactNode;
  tone?: string;
  icon?: IconName;
  glyph?: string;
  action?: React.ReactNode;
  className?: string;
  /** 'alert' on error callouts: screen readers announce the failure
   *  instead of staying silent after a refused action. */
  accessibilityRole?: 'alert';
}) {
  return (
    <View
      accessibilityRole={accessibilityRole}
      className={`flex-row items-center gap-2.5 px-3.5 py-3 rounded-xl ${className}`}
      style={tint(tone, 0.08, 0.25)}>
      {icon && <Icon name={icon} size={18} color={tone} />}
      {glyph && (
        <Txt className="text-[15px]" style={{ color: tone }}>
          {glyph}
        </Txt>
      )}
      <View className="flex-1">
        {typeof children === 'string' ? <Txt className="text-[11.5px] text-text1 leading-[17px]">{children}</Txt> : children}
      </View>
      {action}
    </View>
  );
}
