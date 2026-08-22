import React from 'react';
import { C } from '../theme';
import Svg, { Defs, LinearGradient as SvgGrad, Polygon, Polyline, Stop } from 'react-native-svg';
import { points } from './chart';

export function AreaChart({ data, color = C.amber, height = 60 }: { data: number[]; color?: string; height?: number }) {
  const w = 280;
  const p = points(data, w, height - 10);
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`}>
      <Defs>
        <SvgGrad id="area" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.4} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </SvgGrad>
      </Defs>
      <Polygon points={`0,${height} ${p} ${w},${height}`} fill="url(#area)" />
      <Polyline points={p} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}

/** Deterministic candle chart for the DEX header. */
