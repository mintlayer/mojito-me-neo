import React from 'react';
import { View } from 'react-native';
import { C } from '../../theme';
import { Txt } from '../../ui';
import { Column, Keypad, PinDots, StepHeader } from '.././ui';
import type { Ctx } from '../context';

export function PinPad({
  ctx,
  title,
  subtitle,
  value,
  setValue,
  message,
  error,
}: {
  ctx: Ctx;
  title: string;
  subtitle: string;
  value: string;
  setValue: (v: string) => void;
  message?: string;
  error?: boolean;
}) {
  return (
    <Column>
      <StepHeader onBack={ctx.pop} step={2} />
      <View className="px-6 mt-7 items-center">
        <Txt className="text-[24px] font-bold tracking-tightest">{title}</Txt>
        <Txt className="text-[13px] text-text2 mt-2 text-center">{subtitle}</Txt>
      </View>
      <View className="mt-12">
        <PinDots value={value} error={error} />
      </View>
      <Txt className="text-[12px] text-center mt-4 h-4" style={{ color: C.red }}>
        {message ?? ''}
      </Txt>
      <View className="flex-1" />
      <Keypad onKey={(k) => value.length < 6 && setValue(value + k)} onDelete={() => setValue(value.slice(0, -1))} />
    </Column>
  );
}
