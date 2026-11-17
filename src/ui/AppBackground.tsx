import React from 'react';
import { C } from '../theme';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export function AppBackground() {
  return (
    <Svg style={{ position: 'absolute', width: '100%', height: '100%' }}>
      <Defs>
        {/* One entry per radial-gradient() layer in the design's `.app` rule:
            [id, colour, peak opacity, centre x/y, radius x/y]. */}
        {(
          [
            ['bgA', C.amber, 0.16, '50%', '-10%', '120%', '60%'],
            ['bgB', C.violet, 0.1, '100%', '100%', '80%', '50%'],
            ['bgC', C.teal, 0.08, '0%', '100%', '80%', '50%'],
          ] as const
        ).map(([id, col, op, cx, cy, rx, ry]) => (
          <RadialGradient key={id} id={id} cx={cx} cy={cy} rx={rx} ry={ry}>
            <Stop offset="0" stopColor={col} stopOpacity={op} />
            <Stop offset="0.6" stopColor={col} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      <Rect width="100%" height="100%" fill={C.bg0} />
      <Rect width="100%" height="100%" fill="url(#bgA)" />
      <Rect width="100%" height="100%" fill="url(#bgB)" />
      <Rect width="100%" height="100%" fill="url(#bgC)" />
    </Svg>
  );
}

/** Scrollable screen body. Uses the real safe area instead of the mock's fake
 *  9:41 status bar; on device the OS already draws one.
 *  ponytail: no fake status bar. */
