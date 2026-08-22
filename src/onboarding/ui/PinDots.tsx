import React from 'react';
import { Animated, View } from 'react-native';
import { C } from '../../theme';
import { useShake } from '../../ui';

export function PinDots({ value, error }: { value: string; error?: boolean }) {
  const shake = useShake(error);
  return (
    <Animated.View className="flex-row justify-center gap-3.5" style={shake}>
      {Array.from({ length: 6 }, (_, i) => {
        const on = i < value.length;
        return (
          <View
            key={i}
            className="w-[15px] h-[15px] rounded-full"
            style={{
              backgroundColor: on ? (error ? C.red : C.amber) : 'transparent',
              borderWidth: 1.5,
              borderColor: error ? C.red : on ? C.amber : C.line,
            }}
          />
        );
      })}
    </Animated.View>
  );
}
