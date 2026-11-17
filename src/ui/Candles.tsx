import React, { useMemo } from 'react';
import { C } from '../theme';
import Svg, { G, Line, Rect } from 'react-native-svg';
import type { Candle } from '../data/providers';

/** Presentational candlestick chart: scales the given series into a 320x80 viewbox. */
export function Candles({ candles, height = 80, maxBars = 24 }: { candles: Candle[]; height?: number; maxBars?: number }) {
  const bars = useMemo(() => {
    const shown = candles.slice(-maxBars);
    if (shown.length === 0) return null;
    const hi = Math.max(...shown.map((c) => c.h));
    const lo = Math.min(...shown.map((c) => c.l));
    const span = hi - lo || 1;
    const step = 320 / shown.length;
    const y = (v: number) => 4 + (1 - (v - lo) / span) * 72;
    return {
      last: y(shown[shown.length - 1].c),
      rows: shown.map((c, i) => ({
        x: i * step + step * 0.2,
        w: step * 0.6,
        o: y(c.o),
        c: y(c.c),
        hi: y(c.h),
        lo: y(c.l),
        up: c.c >= c.o,
      })),
    };
  }, [candles, maxBars]);

  if (!bars) return null;
  return (
    <Svg width="100%" height={height} viewBox="0 0 320 80">
      {bars.rows.map((b, i) => {
        const col = b.up ? C.green : C.red;
        return (
          <G key={i}>
            <Line x1={b.x + b.w / 2} y1={b.hi} x2={b.x + b.w / 2} y2={b.lo} stroke={col} strokeWidth={1} />
            <Rect x={b.x} y={Math.min(b.o, b.c)} width={b.w} height={Math.abs(b.c - b.o) || 1} fill={col} />
          </G>
        );
      })}
      {/* Dashed marker sits at the last close, like the old fixed midline. */}
      <Line x1="0" y1={bars.last} x2="320" y2={bars.last} stroke={C.teal} strokeWidth={0.5} strokeDasharray="2 3" opacity={0.6} />
    </Svg>
  );
}
