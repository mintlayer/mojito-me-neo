import React from 'react';
import { View } from 'react-native';
import { Chip } from './Chip';
import { Txt } from './Txt';

export function ScreenIntro({ title, chip, tone, blurb }: { title: string; chip: string; tone: string; blurb: string }) {
  return (
    <View className="px-5">
      <View className="flex-row items-center gap-2.5">
        <Txt className="text-[22px] font-bold tracking-tightest">{title}</Txt>
        <Chip tone={tone}>{chip}</Chip>
      </View>
      <Txt className="text-[12px] text-text2 mt-1">{blurb}</Txt>
    </View>
  );
}

/**
 * Terminal confirmation screen. Send, Swap and Bridge all end in mark + title +
 * mono summary + blurb + primary action; the slots cover what differs.
 */
