import React, { useMemo } from 'react';
import { C } from '../theme';
import Svg, { G, Line, Rect } from 'react-native-svg';

export function Candles({ count = 24, height = 80 }: { count?: number; height?: number }) {
  const bars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const o = 40 + Math.sin(i * 0.5) * 12;
        const c = 40 + Math.sin((i + 1) * 0.5) * 12;
        return { o, c, hi: Math.min(o, c) - 5, lo: Math.max(o, c) + 5, up: c < o, x: i * 13 + 4 };
      }),
    [count],
  );
  return (
    <Svg width="100%" height={height} viewBox="0 0 320 80">
      {bars.map((b, i) => {
        const col = b.up ? C.green : C.red;
        return (
          <G key={i}>
            <Line x1={b.x + 4} y1={b.hi} x2={b.x + 4} y2={b.lo} stroke={col} strokeWidth={1} />
            <Rect x={b.x} y={Math.min(b.o, b.c)} width={8} height={Math.abs(b.c - b.o) || 1} fill={col} />
          </G>
        );
      })}
      <Line x1="0" y1="40" x2="320" y2="40" stroke={C.teal} strokeWidth={0.5} strokeDasharray="2 3" opacity={0.6} />
    </Svg>
  );
}
