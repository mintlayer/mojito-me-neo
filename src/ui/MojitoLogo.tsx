import React from 'react';
import { View } from 'react-native';
import { C, G as GR, alpha } from '../theme';
import { Spin } from './motion';
import Svg, { Circle, Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';

export function MojitoLogo({ size = 48, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg viewBox="0 0 64 64" width={size} height={size}>
        <Defs>
          <SvgGrad id="lgA" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={GR.amber[0]} />
            <Stop offset="1" stopColor={GR.amberDeep[1]} />
          </SvgGrad>
          <SvgGrad id="lgT" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={C.teal} />
            <Stop offset="1" stopColor={C.violet} />
          </SvgGrad>
        </Defs>
        <Circle cx={32} cy={32} r={30} fill={C.bg1} stroke="url(#lgA)" strokeWidth={1.2} opacity={0.6} />
        <Path
          d="M16 46 L16 18 L32 36 L48 18 L48 46"
          fill="none"
          stroke="url(#lgA)"
          strokeWidth={3.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Path
          d="M22 46 L22 28 L32 38 L42 28 L42 46"
          fill="none"
          stroke="url(#lgT)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.85}
        />
        <Circle cx={32} cy={36} r={2.4} fill="url(#lgA)" />
      </Svg>
      {animate && (
        <Spin
          style={{
            position: 'absolute',
            width: size + 8,
            height: size + 8,
            borderRadius: (size + 8) / 2,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: alpha(C.amber, 0.35),
          }}>
          <View />
        </Spin>
      )}
    </View>
  );
}
