import React, { forwardRef } from 'react';
import { C, alpha, white } from '../../theme';
import { TextInput, View } from 'react-native';
import { Txt } from '../../ui';

export const WordSlot = forwardRef<
  TextInput,
  {
    index: number;
    value: string;
    active: boolean;
    bad: boolean;
    onChangeText: (v: string) => void;
    onFocus: () => void;
    onSubmit: () => void;
  }
>(function WordSlot({ index, value, active, bad, onChangeText, onFocus, onSubmit }, ref) {
  return (
    <View
      className="flex-row items-center gap-1 px-2 h-[38px] rounded-[9px]"
      style={{
        backgroundColor: bad ? alpha(C.red, 0.08) : white(0.04),
        borderWidth: 1,
        borderColor: bad ? C.red : active ? C.amber : C.lineSoft,
      }}>
      <Txt mono className="text-[9px] text-text3 min-w-[13px]">
        {index + 1}
      </Txt>
      <TextInput
        ref={ref}
        value={value}
        // Raw text goes up: RN has no onPaste, so the parent detects a
        // multi-word paste before the single-word sanitiser runs.
        onChangeText={onChangeText}
        onFocus={onFocus}
        onSubmitEditing={onSubmit}
        accessibilityLabel={`Word ${index + 1}`}
        blurOnSubmit={false}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        className="flex-1 font-mono text-[11.5px] font-medium text-text0 p-0"
      />
    </View>
  );
});

/** Large icon badge — the discovery scanner and its empty state. */
