import React from 'react';
import { View } from 'react-native';
import { C } from '../../theme';
import { Txt } from '../../ui';
import { Column, Keypad, PinDots, StepHeader } from '../ui';
import type { Ctx } from '../context';

export function PinPad({
  ctx,
  title,
  subtitle,
  value,
  setValue,
  message,
  error,
  disabled,
}: {
  ctx: Ctx;
  title: string;
  subtitle: string;
  value: string;
  setValue: (v: string) => void;
  message?: string;
  error?: boolean;
  /** True while a lockout is armed: freezes the keypad like UnlockScreen. */
  disabled?: boolean;
}) {
  return (
    <Column>
      {/* pinOnly (Change PIN) is a Settings action, not an onboarding step:
          no stepper, and the stack has no back to go to (pop is a no-op at
          stack length 1, so the chevron would be a dead control). */}
      {!ctx.pinOnly && <StepHeader onBack={ctx.pop} step={2} />}
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
      <Keypad
        disabled={disabled}
        onKey={(k) => value.length < 6 && setValue(value + k)}
        onDelete={() => setValue(value.slice(0, -1))}
      />
    </Column>
  );
}
