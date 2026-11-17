import React from 'react';
import { Pressable, View } from 'react-native';
import { C, alpha, white } from '../theme';
import { Txt } from './Txt';

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = 'tray',
  accent = C.text0,
  accents,
  className = '',
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange?: (v: T) => void;
  variant?: 'tray' | 'tabs' | 'ghost' | 'pill';
  accent?: string;
  accents?: Partial<Record<T, string>>;
  className?: string;
  labels?: Partial<Record<T, string>>;
}) {
  const wrap = variant === 'tray' ? 'flex-row gap-1 p-[3px] rounded-lg' : variant === 'pill' ? 'flex-row gap-1.5' : 'flex-row gap-1';
  return (
    <View className={`${wrap} ${className}`} style={variant === 'tray' ? { backgroundColor: white(0.04) } : undefined}>
      {options.map((o) => {
        const on = o === value;
        const a = accents?.[o] ?? accent;
        const shape =
          variant === 'tabs'
            ? 'flex-1 py-2 rounded-lg'
            : variant === 'pill'
              ? 'px-3.5 py-2 rounded-full flex-row gap-1.5'
              : 'px-2.5 py-1 rounded-md';
        const bg = !on
          ? variant === 'pill'
            ? white(0.03)
            : 'transparent'
          : variant === 'tray'
            ? white(0.06)
            : alpha(a, 0.14);
        return (
          <Pressable
            key={o}
            onPress={() => onChange?.(o)}
            className={`items-center justify-center ${shape}`}
            style={{
              backgroundColor: bg,
              borderWidth: variant === 'tabs' || variant === 'pill' ? 1 : 0,
              borderColor: on ? (variant === 'pill' ? a : C.line) : variant === 'pill' ? C.lineSoft : 'transparent',
            }}>
            {variant === 'pill' && <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a }} />}
            <Txt className={`${variant === 'tabs' ? 'text-[12px]' : 'text-[11px]'} font-medium`} style={{ color: on ? a : C.text2 }}>
              {labels?.[o] ?? o}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 25 / 50 / 75 / Max: dex ticket, send amount, swap panel. */
