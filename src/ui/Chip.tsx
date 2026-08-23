import React from 'react';
import { View } from 'react-native';
import { C, alpha, white } from '../theme';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Txt } from './Txt';

export function Chip({
  children,
  tone,
  dot = true,
  icon,
}: {
  children: React.ReactNode;
  tone?: string;
  dot?: boolean;
  /** Replaces the leading dot, e.g. the lock on "screenshots are blocked". */
  icon?: IconName;
}) {
  const c = tone ?? C.text1;
  return (
    <View
      className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{
        backgroundColor: tone ? alpha(c, 0.14) : white(0.03),
        borderWidth: 1,
        borderColor: tone ? alpha(c, 0.35) : C.line,
      }}>
      {icon ? (
        <Icon name={icon} size={12} color={c} />
      ) : (
        dot && <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
      )}
      <Txt className="text-[11px] font-medium tracking-wider" style={{ color: c }}>
        {children}
      </Txt>
    </View>
  );
}

/**
 * Tinted notice box: leading icon (or glyph) + body + optional trailing action.
 * The Face-ID hint, the receive-address warning, the bad-checksum error and the
 * deferred-backup banner are all this component.
 */
