import React from 'react';
import { View } from 'react-native';
import { C, white } from '../theme';
import { PulseRings, Ticker } from './motion';
import { StepState } from './StepState';
import { Txt } from './Txt';

export function Steps({ steps }: { steps: { label: string; detail: string; state: StepState; note?: string }[] }) {
  return (
    <View>
      {steps.map((s, i) => (
        <View key={s.label} className="flex-row gap-3">
          <View className="items-center">
            <View
              className="w-[22px] h-[22px] rounded-full items-center justify-center"
              style={{
                backgroundColor: s.state === 'done' ? C.teal : s.state === 'active' ? C.amber : white(0.06),
                borderWidth: s.state === 'pending' ? 1 : 0,
                borderColor: C.line,
              }}>
              {s.state === 'active' && <PulseRings size={22} color={C.amber} count={2} />}
              {s.state === 'active' ? (
                <Ticker>
                  <Txt className="text-[11px] font-bold" style={{ color: C.ink }}>
                    ●
                  </Txt>
                </Ticker>
              ) : (
                <Txt className="text-[11px] font-bold" style={{ color: s.state === 'done' ? C.ink : C.text2 }}>
                  {s.state === 'done' ? '✓' : i + 1}
                </Txt>
              )}
            </View>
            {i < steps.length - 1 && (
              <View
                className="w-px flex-1 min-h-[28px] opacity-50"
                style={{ backgroundColor: s.state === 'done' ? C.teal : C.line }}
              />
            )}
          </View>
          <View className="flex-1 pb-4">
            <Txt className="text-[13px] font-medium" style={{ color: s.state === 'pending' ? C.text2 : C.text0 }}>
              {s.label}
            </Txt>
            <Txt mono className="text-[11px] text-text2 mt-0.5">
              {s.detail}
            </Txt>
          </View>
          {s.note && (
            <Txt mono className="text-[10px] mt-1" style={{ color: C.amber }}>
              {s.note}
            </Txt>
          )}
        </View>
      ))}
    </View>
  );
}

/** Pulsing confirmation badge. Send success, card waitlist, onboarding done. */
