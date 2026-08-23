import React from 'react';
import { Animated, Pressable } from 'react-native';
import { C, white } from '../../theme';
import { Txt, useShake } from '../../ui';

export function WordChip({ word, onPress, used, wrong }: { word: string; onPress?: () => void; used?: boolean; wrong?: boolean }) {
  const shake = useShake(wrong);
  return (
    <Animated.View style={shake}>
      <Pressable
        disabled={used}
        onPress={onPress}
        className="px-3 py-2 rounded-[9px]"
        style={{ backgroundColor: white(0.05), borderWidth: 1, borderColor: wrong ? C.red : C.lineSoft, opacity: used ? 0.35 : 1 }}>
        <Txt
          mono
          className="text-[12px] font-medium"
          style={{ color: wrong ? C.red : C.text0, textDecorationLine: used ? 'line-through' : 'none' }}>
          {word}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Numbered read-only word cells. `columns` covers both the 24-word (3-up) and
 * 12-word (2-up) layouts in the design.
 *
 * While `hidden`, the words are NOT rendered — each cell shows a fixed mask.
 * The design blurs the grid with a CSS filter, but there is no equivalent in
 * React Native: expo-blur degrades to a flat tint on Android, leaving the
 * phrase perfectly legible, and even a real blur would keep the secret in the
 * view tree where an accessibility service or screen scraper can read it.
 * The mask is constant width on purpose — sizing it per word would leak each
 * word's length and cut the BIP39 candidate set for anyone shoulder-surfing.
 */
