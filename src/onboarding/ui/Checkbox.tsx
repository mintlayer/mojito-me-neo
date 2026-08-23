import React from 'react';
import { C } from '../../theme';
import { Icon, Txt } from '../../ui';
import { Pressable, View } from 'react-native';

export function Checkbox({
  checked,
  onToggle,
  label,
  children,
  size = 22,
}: {
  checked: boolean;
  onToggle: () => void;
  label?: string;
  children?: React.ReactNode;
  size?: number;
}) {
  return (
    <Pressable onPress={onToggle} className="flex-row items-center gap-3">
      <View
        className="items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: 7,
          backgroundColor: checked ? C.amber : 'transparent',
          borderWidth: 1.5,
          borderColor: checked ? C.amber : C.line,
        }}>
        {checked && <Icon name="check" size={size * 0.6} color="#1a1208" stroke={3} />}
      </View>
      {label ? <Txt className="text-[13px] font-medium text-text1 flex-1">{label}</Txt> : children}
    </Pressable>
  );
}

/* ── Seed screen protection ─────────────────────────────────── */

/** Android can genuinely block capture; iOS cannot, so don't claim it there. */
