import React from 'react';
import { C } from '../theme';
import Svg, { Polyline } from 'react-native-svg';
import { points } from './chart';

export function Sparkline({
  data,
  color = C.amber,
  width = 70,
  height = 28,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points(data, width, height)}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Filled sparkline: the balance card chart on Home. */
