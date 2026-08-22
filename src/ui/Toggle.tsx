import React from 'react';
import { Pressable, View } from 'react-native';
import { C, white } from '../theme';

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!on)}
      className="w-[42px] h-[26px] rounded-full justify-center"
      style={{ backgroundColor: on ? C.amber : white(0.08), borderWidth: on ? 0 : 1, borderColor: C.line }}>
      <View
        className="w-5 h-5 rounded-full bg-white absolute"
        style={{
          left: on ? 19 : 3,
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
        }}
      />
    </Pressable>
  );
}

/**
 * One control for every option group in the app. The four variants map to the
 * visual treatments the design uses; `accent`/`accents` colour the selection.
 */
