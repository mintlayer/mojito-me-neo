import React from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, G as GR } from '../theme';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Txt } from './Txt';
import { gradColors } from './style';

type BtnTone = 'primary' | 'teal' | 'violet' | 'green' | 'red' | 'default' | 'ghost';

const BTN_TONES: Record<BtnTone, { grad?: readonly string[]; fg: string; border?: string }> = {
  primary: { grad: GR.amber, fg: '#1a1208' },
  teal: { grad: GR.teal, fg: '#06181c' },
  violet: { grad: GR.violet, fg: '#150622' },
  green: { grad: GR.green, fg: '#06210e' },
  red: { grad: GR.red, fg: '#220607' },
  default: { grad: GR.surface, fg: C.text0, border: C.line },
  ghost: { fg: C.text2 },
};

export type { BtnTone };

export function Btn({
  children,
  onPress,
  tone = 'default',
  disabled,
  className = '',
  icon,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  tone?: BtnTone;
  disabled?: boolean;
  className?: string;
  icon?: IconName;
}) {
  const t = BTN_TONES[tone];
  const body = (
    <View className="flex-row items-center justify-center gap-2 h-[52px] px-4">
      {icon && <Icon name={icon} size={16} color={t.fg} stroke={2} />}
      <Txt className="text-[15px] font-semibold" style={{ color: t.fg }}>
        {children}
      </Txt>
    </View>
  );
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className={`rounded-2xl overflow-hidden ${className}`}
      style={{ opacity: disabled ? 0.4 : 1 }}>
      {t.grad ? (
        <LinearGradient
          colors={gradColors(t.grad)}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ borderWidth: 1, borderColor: t.border ?? (t.grad[0] as string), borderRadius: 16 }}>
          {body}
        </LinearGradient>
      ) : (
        body
      )}
    </Pressable>
  );
}

/** 36x36 rounded-square action: header settings/bell, sheet close. */
