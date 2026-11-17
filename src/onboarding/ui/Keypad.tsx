import React from 'react';
import { C } from '../../theme';
import { Icon, Txt, tile } from '../../ui';
import { Pressable, View } from 'react-native';
import { t } from '../../i18n';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Module scope, not nested in Keypad: a per-render component identity would
 *  remount all twelve keys on every digit typed. */

function Key({ label, onPress, children }: { label?: string; onPress: () => void; children?: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? t('common.delete')}
      className="h-14 rounded-[14px] items-center justify-center"
      style={[tile(), { width: '31%' }]}>
      {children ?? <Txt className="text-[22px] font-medium">{label}</Txt>}
    </Pressable>
  );
}

export function Keypad({
  onKey,
  onDelete,
  corner,
  disabled,
}: {
  onKey: (k: string) => void;
  onDelete: () => void;
  /** Bottom-left slot: the biometric shortcut on the unlock screen. */
  corner?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <View
      className="flex-row flex-wrap justify-between gap-y-2 px-7"
      pointerEvents={disabled ? 'none' : 'auto'}
      style={{ opacity: disabled ? 0.35 : 1 }}>
      {KEYS.map((k) => (
        <Key key={k} label={k} onPress={() => onKey(k)} />
      ))}
      <View className="h-14 items-center justify-center" style={{ width: '31%' }}>
        {corner}
      </View>
      <Key label="0" onPress={() => onKey('0')} />
      <Key onPress={onDelete}>
        <Icon name="backspace" size={22} color={C.text2} />
      </Key>
    </View>
  );
}

/* ── Biometrics ─────────────────────────────────────────────── */
