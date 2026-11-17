import React from 'react';
import { View } from 'react-native';
import { C, alpha } from '../theme';
import { PulseRings } from './motion';
import { Txt } from './Txt';

export function SuccessMark({ size = 96, color = C.green, glyph = '✓' }: { size?: number; color?: string; glyph?: string }) {
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <PulseRings size={size} color={alpha(color, 0.6)} count={2} />
      <View
        className="items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: alpha(color, 0.18),
          borderWidth: 1.5,
          borderColor: color,
        }}>
        <Txt className="font-bold" style={{ color, fontSize: size * 0.44 }}>
          {glyph}
        </Txt>
      </View>
    </View>
  );
}

/** Decorative QR: deterministic from the address, not a real encoder. */
