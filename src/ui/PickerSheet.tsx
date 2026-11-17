import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { C } from '../theme';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { Txt } from './Txt';
import { hairlineTop } from './style';

export function PickerSheet<T extends string>({
  open,
  onClose,
  title,
  options,
  value,
  onSelect,
  renderLeading,
  subtitleFor,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: readonly T[];
  value?: T;
  onSelect: (v: T) => void;
  renderLeading?: (v: T) => React.ReactNode;
  subtitleFor?: (v: T) => string | undefined;
  /** Display copy per option; ids stay internal so copy comes from i18n. */
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {options.map((o, i) => (
          <Pressable
            key={o}
            onPress={() => {
              onSelect(o);
              onClose();
            }}
            className="flex-row items-center gap-3 py-3"
            style={i > 0 ? hairlineTop : undefined}>
            {renderLeading?.(o)}
            <View className="flex-1">
              <Txt className="text-[14px] font-medium">{labels?.[o] ?? o}</Txt>
              {subtitleFor?.(o) ? <Txt className="text-[11px] text-text2 mt-0.5">{subtitleFor(o)}</Txt> : null}
            </View>
            {value === o && <Icon name="check" size={16} color={C.amber} stroke={2.5} />}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** Asset chooser. Shared by Send, Swap and Bridge so the list can't drift. */
