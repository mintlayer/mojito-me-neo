import React from 'react';
import type { IconName } from '../../ui';
import { C, alpha, white } from '../../theme';
import { Icon, PulseRings } from '../../ui';
import { View } from 'react-native';

export function BigBadge({
  icon,
  tone = C.amber,
  size = 90,
  pulsing,
  square,
}: {
  icon: IconName;
  tone?: string;
  size?: number;
  pulsing?: boolean;
  square?: boolean;
}) {
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center self-center">
      {pulsing && <PulseRings size={size} color={alpha(tone, 0.5)} count={2} duration={1600} />}
      <View
        className="items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: square ? 20 : size / 2,
          backgroundColor: square ? white(0.04) : alpha(tone, 0.08),
          borderWidth: square ? 1 : 1.5,
          borderColor: square ? C.lineSoft : tone,
        }}>
        <Icon name={icon} size={size * 0.4} color={square ? C.text2 : tone} stroke={1.4} />
      </View>
    </View>
  );
}
