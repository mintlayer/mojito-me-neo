import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { C, G as GR } from '../theme';
import { Txt } from './Txt';
import { gradColors } from './style';

export function Avatar({
  letter,
  size = 32,
  radius = 10,
  colors = GR.amberDeep,
}: {
  letter: string;
  size?: number;
  radius?: number;
  colors?: readonly string[];
}) {
  return (
    <LinearGradient
      colors={gradColors(colors)}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: radius, alignItems: 'center', justifyContent: 'center' }}>
      <Txt className="font-bold" style={{ color: C.ink, fontSize: size * 0.44 }}>
        {letter}
      </Txt>
    </LinearGradient>
  );
}
